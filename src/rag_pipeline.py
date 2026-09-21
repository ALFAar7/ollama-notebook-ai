"""
RAG translation pipeline: retrieve relevant past translations and augment prompt.
"""

from typing import List, Dict, Optional
from src.vector_store import VectorStore
from src.embedding import generate_embedding
from src.ollama import translate_with_ollama
from src.text_utils import split_text_for_translation


class RAGPipeline:
    def __init__(self, vector_store: VectorStore = None):
        self.vector_store = vector_store or VectorStore()

    def _extract_key_concepts(self, text: str) -> List[str]:
        import re
        stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
                       'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
                       'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
                       'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
                       'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
                       'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'their',
                       'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'how',
                       'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
                       'just', 'about', 'also', 'some', 'any', 'all', 'each', 'every',
                       'both', 'few', 'more', 'most', 'other', 'such', 'only', 'own',
                       'same', 'into', 'up', 'out', 'off', 'over', 'under', 'again',
                       'further', 'once', 'here', 'there', 'while', 'before', 'after',
                       'above', 'below', 'between', 'through', 'during', 'because', 'as'}
        words = re.findall(r'[a-zA-Z][a-zA-Z0-9_-]{2,}', text.lower())
        return [w for w in words if w not in stop_words]

    def _generate_retrieval_terms(self, text: str) -> List[str]:
        concepts = self._extract_key_concepts(text)
        seen = set()
        terms = []
        for concept in concepts:
            if concept not in seen:
                seen.add(concept)
                terms.append(concept)
        return terms[:20]

    def translate_with_context(
        self,
        text: str,
        target_language: str,
        source_language: str = 'auto',
        top_k: int = 5,
        similarity_threshold: float = None
    ) -> str:
        """
        Translate text using RAG context from similar past translations.
        Falls back to standard translation if no relevant context found.
        """
        if similarity_threshold is None:
            from src.vector_store import SIMILARITY_THRESHOLD
            similarity_threshold = SIMILARITY_THRESHOLD

        retrieval_terms = self._generate_retrieval_terms(text)

        query_embedding = generate_embedding(text)

        all_results = self.vector_store.search(
            query_embedding,
            limit=top_k * 3
        )

        similar = [r for r in all_results if r['similarity'] >= similarity_threshold][:top_k]

        if not similar:
            # No relevant context, translate normally
            return translate_with_ollama(text, target_language, source_language)

        # Build context from retrieved translations
        context_parts = []
        for item in similar:
            context_parts.append(
                f"Source ({item['metadata'].get('source_language', 'unknown')}): {item['source_text'][:300]}...\n"
                f"Target ({item['metadata'].get('target_language', 'unknown')}): {item['translated_text'][:300]}..."
            )
        context = "\n\n---\n\n".join(context_parts)

        # Augmented prompt
        terms_str = ', '.join(retrieval_terms[:10]) if retrieval_terms else ''
        prompt = (
            f"Given these previous translations as context for terminology and style:\n\n"
            f"{context}\n\n"
            f"Key terms/concepts to maintain: {terms_str}\n\n"
            f"Translate the following text from {source_language} to {target_language}.\n"
            f"Maintain consistent terminology and style with the examples above.\n"
            f"Only provide the translation, no explanations.\n\n"
            f"Text to translate:\n{text}"
        )

        return translate_with_ollama(prompt, target_language, source_language)

    def ingest_document(self, filename: str, text: str, source_language: str, target_language: str) -> List[str]:
        """
        Chunk document, generate embeddings, store in vector store.
        Returns list of stored IDs.
        """
        import re
        chunks = split_text_for_translation(text)
        stored_ids = []

        for index, chunk in enumerate(chunks):
            if not chunk.strip():
                continue
            page_number = None
            page_match = re.search(r'--- Page (\d+) ---', chunk)
            if page_match:
                page_number = int(page_match.group(1))
            embedding = generate_embedding(chunk)
            # For ingestion, we don't have translation yet - store source only
            # Translation will be stored when user translates
            metadata = {
                'filename': filename,
                'source_language': source_language,
                'target_language': target_language,
                'type': 'source',
                'page_number': page_number,
                'chunk_index': index,
            }
            item_id = self.vector_store.add(
                source_text=chunk,
                translation='',  # Will be filled when translated
                embedding=embedding,
                metadata=metadata
            )
            stored_ids.append(item_id)

        return stored_ids

    def store_translation(
        self,
        source_text: str,
        translated_text: str,
        source_language: str,
        target_language: str,
        filename: str = None,
        page_number: int = None,
        mode: str = 'text'
    ) -> str:
        """Store a completed translation with its embedding for future retrieval."""
        embedding = generate_embedding(source_text)
        metadata = {
            'source_language': source_language,
            'target_language': target_language,
            'type': 'translation',
            'mode': mode
        }
        if filename:
            metadata['filename'] = filename
        if page_number:
            metadata['page_number'] = page_number

        return self.vector_store.add(
            source_text=source_text,
            translation=translated_text,
            embedding=embedding,
            metadata=metadata
        )


# Singleton instance for easy import
_pipeline = None


def get_pipeline() -> RAGPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = RAGPipeline()
    return _pipeline