"""
Vector storage using a local SQLite database.
Stores embeddings and metadata for translation search.
"""

import os
import json
import uuid
import sqlite3
from typing import List, Dict, Optional, Tuple, Callable

VECTOR_STORE_DIR = os.environ.get('VECTOR_STORE_DIR') or os.environ.get('CHROMA_DB_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vector_store')
COLLECTION_NAME = os.environ.get('VECTOR_COLLECTION', 'translation_embeddings')
SIMILARITY_THRESHOLD = float(os.environ.get('VECTOR_SIMILARITY_THRESHOLD', '0.3'))


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

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

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
        return item_id

    def search(self, query_embedding: List[float], limit: int = 5, metadata_filter: dict = None, similarity_threshold: float = None, entry_type: str = None) -> List[dict]:
        """
        Vector search using cosine similarity.
        Returns list of {id, source_text, translated_text, similarity, metadata}.

        Args:
            entry_type: Optional filter on metadata['type'] (e.g. 'source' or 'translation').
        """
        if similarity_threshold is None:
            similarity_threshold = SIMILARITY_THRESHOLD
        if not query_embedding:
            return []

        conn = self._connect()
        rows = conn.execute('SELECT id, embedding, source_text, translated_text, metadata FROM embeddings').fetchall()
        conn.close()

        results = []
        for row in rows:
            row_metadata = json.loads(row['metadata']) if row['metadata'] else {}
            if entry_type is not None and row_metadata.get('type') != entry_type:
                continue
            embedding = json.loads(row['embedding'])
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

    def clear(self):
        conn = self._connect()
        conn.execute('DELETE FROM embeddings')
        conn.commit()
        conn.close()


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)