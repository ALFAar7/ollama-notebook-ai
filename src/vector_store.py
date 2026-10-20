"""
Vector storage using a local SQLite database.
Stores embeddings and metadata for translation search.
"""

import os
import json
import uuid
import sqlite3
import numpy as np
from typing import List, Dict, Optional, Tuple, Callable

VECTOR_STORE_DIR = os.environ.get('VECTOR_STORE_DIR') or os.environ.get('CHROMA_DB_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vector_store')
COLLECTION_NAME = os.environ.get('VECTOR_COLLECTION', 'translation_embeddings')
# Calibrated against this corpus with REAL user queries (see docs/SEARCH-TUNING.md).
# For this single English book: on-topic queries score 0.64-0.82 against their
# best chunk, off-topic queries score 0.42-0.58. The gap is [0.58, 0.64], so 0.60
# returns results for every on-topic query and nothing for any off-topic one.
# A threshold of 0.3 is far below the noise floor and filters nothing.
SIMILARITY_THRESHOLD = float(os.environ.get('VECTOR_SIMILARITY_THRESHOLD', '0.60'))

# Rows held in the in-memory similarity matrix. A 768-dim float32 vector costs
# ~3 KB, so this cap is roughly 600 MB. Beyond it the matrix is not built and
# search falls back to a streaming per-row scan.
IN_MEMORY_INDEX_MAX_ROWS = 200_000


def _init_db(db_path: str):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS embeddings (
            id TEXT PRIMARY KEY,
            embedding TEXT NOT NULL,
            source_text TEXT,
            translated_text TEXT,
            metadata TEXT
        )
    ''')
    conn.commit()
    conn.close()


class VectorStore:
    def __init__(self, persist_directory: str = VECTOR_STORE_DIR, collection_name: str = COLLECTION_NAME):
        self.persist_directory = persist_directory
        self.collection_name = collection_name
        os.makedirs(persist_directory, exist_ok=True)
        self.db_path = os.path.join(persist_directory, f'{collection_name}.db')
        _init_db(self.db_path)
        self._matrix = None
        self._index_rows = None

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _invalidate_index(self):
        """Drop the cached matrix so the next search rebuilds it."""
        self._matrix = None
        self._index_rows = None

    def _build_index(self):
        """
        Load every embedding into an L2-normalized float32 matrix once, so that
        cosine similarity becomes a single matrix-vector product instead of a
        Python loop over the whole table.
        """
        conn = self._connect()
        total = conn.execute('SELECT COUNT(*) FROM embeddings').fetchone()[0]
        if total > IN_MEMORY_INDEX_MAX_ROWS:
            conn.close()
            self._matrix = None
            self._index_rows = None
            return False

        rows = conn.execute(
            'SELECT id, embedding, source_text, translated_text, metadata FROM embeddings'
        ).fetchall()
        conn.close()

        vectors = []
        parsed = []
        for row in rows:
            try:
                vector = json.loads(row['embedding'])
            except (TypeError, ValueError):
                continue
            if not vector:
                continue
            vectors.append(vector)
            parsed.append({
                'id': row['id'],
                'source_text': row['source_text'],
                'translated_text': row['translated_text'],
                'metadata': json.loads(row['metadata']) if row['metadata'] else {},
            })

        if not vectors:
            self._matrix = np.zeros((0, 0), dtype=np.float32)
            self._index_rows = parsed
            return True

        matrix = np.asarray(vectors, dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        # Leave all-zero rows unscaled: their similarity stays 0.0 and they fall
        # below the threshold, matching the previous behaviour.
        norms[norms == 0] = 1.0
        matrix /= norms

        self._matrix = matrix
        self._index_rows = parsed
        return True

    def _get_index(self):
        if self._matrix is None and not self._build_index():
            return None, None
        return self._matrix, self._index_rows

    def add(self, source_text: str, translation: str, embedding: List[float], metadata: dict = None):
        """Store a translation chunk with embedding and metadata."""
        conn = self._connect()
        item_id = str(uuid.uuid4())
        embedding_json = json.dumps(embedding)
        metadata_json = json.dumps(metadata or {})
        conn.execute(
            'INSERT INTO embeddings (id, embedding, source_text, translated_text, metadata) VALUES (?, ?, ?, ?, ?)',
            (item_id, embedding_json, source_text, translation, metadata_json)
        )
        conn.commit()
        conn.close()
        self._invalidate_index()
        return item_id

    def search(self, query_embedding: List[float], limit: int = 5, metadata_filter: dict = None, similarity_threshold: float = None, entry_type: str = None) -> List[dict]:
        """
        Vector search using cosine similarity.
        Returns list of {id, source_text, translated_text, similarity, metadata}.

        Args:
            entry_type: Optional filter on metadata['type'] (e.g. 'source' or 'translation').
            metadata_filter: Optional exact-match filter on metadata keys, e.g. {'filename': 'book.pdf'}.
        """
        if similarity_threshold is None:
            similarity_threshold = SIMILARITY_THRESHOLD
        if not query_embedding:
            return []

        query = np.asarray(query_embedding, dtype=np.float32)
        if query.ndim != 1 or query.size == 0:
            return []

        matrix, rows = self._get_index()
        if matrix is None:
            # Store is too large to hold in memory; score row by row instead.
            return self._search_streaming(
                query.tolist(), limit, metadata_filter, similarity_threshold, entry_type
            )
        if not rows:
            return []
        # Embeddings from different models have different dimensions; such a
        # query cannot be compared against the stored matrix.
        if query.shape[0] != matrix.shape[1]:
            return []

        query_norm = np.linalg.norm(query)
        if query_norm == 0:
            return []
        query = query / query_norm

        mask = np.ones(len(rows), dtype=bool)
        if entry_type is not None:
            mask &= np.fromiter(
                (row['metadata'].get('type') == entry_type for row in rows), bool, len(rows)
            )
        if metadata_filter:
            for key, value in metadata_filter.items():
                mask &= np.fromiter(
                    (row['metadata'].get(key) == value for row in rows), bool, len(rows)
                )

        candidate_idx = np.flatnonzero(mask)
        if candidate_idx.size == 0:
            return []

        scores = matrix[candidate_idx] @ query
        keep = scores >= similarity_threshold
        candidate_idx = candidate_idx[keep]
        scores = scores[keep]
        if candidate_idx.size == 0:
            return []

        # Stable sort so rows with identical similarity keep their original
        # order, matching the previous list.sort() behaviour.
        order = np.argsort(-scores, kind='stable')[:limit]
        results = []
        for position in order:
            row = rows[candidate_idx[position]]
            results.append({
                'id': row['id'],
                'source_text': row['source_text'],
                'translated_text': row['translated_text'],
                'similarity': float(scores[position]),
                'metadata': row['metadata']
            })
        return results

    def _search_streaming(self, query_embedding: List[float], limit: int, metadata_filter: dict, similarity_threshold: float, entry_type: str) -> List[dict]:
        """
        Fallback for stores too large to cache in memory. Correct but slow:
        parses and scores every row on each call.
        """
        conn = self._connect()
        rows = conn.execute('SELECT id, embedding, source_text, translated_text, metadata FROM embeddings').fetchall()
        conn.close()

        results = []
        for row in rows:
            row_metadata = json.loads(row['metadata']) if row['metadata'] else {}
            if entry_type is not None and row_metadata.get('type') != entry_type:
                continue
            try:
                embedding = json.loads(row['embedding'])
            except (TypeError, ValueError):
                continue
            similarity = _cosine_similarity(query_embedding, embedding)
            if similarity < similarity_threshold:
                continue
            if metadata_filter:
                if not all(row_metadata.get(k) == v for k, v in metadata_filter.items()):
                    continue
            results.append({
                'id': row['id'],
                'source_text': row['source_text'],
                'translated_text': row['translated_text'],
                'similarity': similarity,
                'metadata': row_metadata
            })

        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:limit]

    def get(self, item_id: str) -> Optional[dict]:
        conn = self._connect()
        row = conn.execute('SELECT * FROM embeddings WHERE id = ?', (item_id,)).fetchone()
        conn.close()
        if not row:
            return None
        return dict(row)

    def delete(self, item_id: str):
        conn = self._connect()
        conn.execute('DELETE FROM embeddings WHERE id = ?', (item_id,))
        conn.commit()
        conn.close()
        self._invalidate_index()

    def delete_by_metadata(self, metadata_filter: dict) -> int:
        """
        Delete every embedding whose metadata matches the given key/value pairs.

        The metadata column holds JSON, so matching happens in SQL with a
        json_extract() lookup rather than by loading the whole table.

        Args:
            metadata_filter: Exact-match pairs, e.g. {'filename': 'book.pdf'}.

        Returns:
            The number of rows removed.
        """
        if not metadata_filter:
            return 0
        conn = self._connect()
        try:
            where = ' AND '.join(
                "json_extract(metadata, '$.' || ?) = ?" for _ in metadata_filter
            )
            params = []
            for key, value in metadata_filter.items():
                params.extend([key, value])
            cursor = conn.execute(
                f'DELETE FROM embeddings WHERE {where}', params
            )
            deleted = cursor.rowcount
            conn.commit()
        finally:
            conn.close()
        self._invalidate_index()
        return deleted

    def count(self, metadata_filter: dict = None) -> int:
        """Number of stored embeddings, optionally filtered by metadata."""
        conn = self._connect()
        try:
            if metadata_filter:
                where = ' AND '.join(
                    "json_extract(metadata, '$.' || ?) = ?" for _ in metadata_filter
                )
                params = []
                for key, value in metadata_filter.items():
                    params.extend([key, value])
                row = conn.execute(
                    f'SELECT COUNT(*) FROM embeddings WHERE {where}', params
                ).fetchone()
            else:
                row = conn.execute('SELECT COUNT(*) FROM embeddings').fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()

    def documents(self) -> List[dict]:
        """
        Summarise the knowledge base per source document.

        Returns one entry per distinct filename with its chunk count, so the UI
        can show what is indexed and let the user drop a single document.
        """
        conn = self._connect()
        try:
            rows = conn.execute(
                'SELECT metadata FROM embeddings'
            ).fetchall()
        finally:
            conn.close()

        summary = {}
        for row in rows:
            try:
                metadata = json.loads(row['metadata']) if row['metadata'] else {}
            except (TypeError, ValueError):
                metadata = {}
            filename = metadata.get('filename') or ''
            entry = summary.setdefault(filename, {
                'filename': filename,
                'chunks': 0,
                'pages': set(),
                'type': metadata.get('type', 'source'),
            })
            entry['chunks'] += 1
            page = metadata.get('page_number')
            if page:
                entry['pages'].add(int(page))

        documents = []
        for entry in summary.values():
            pages = entry.pop('pages')
            entry['page_count'] = len(pages)
            entry['max_page'] = max(pages) if pages else None
            documents.append(entry)
        documents.sort(key=lambda item: (-item['chunks'], item['filename']))
        return documents

    def clear(self):
        conn = self._connect()
        conn.execute('DELETE FROM embeddings')
        conn.commit()
        conn.close()
        self._invalidate_index()


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)