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

    def translate_with_context(
        self,
        text: str,
        target_language: str,
        source_language: str = 'auto',
        top_k: int = 5,
        similarity_threshold: float = 0.3
    ) -> str:
        """
        Translate text using RAG context from similar past translations.
        Falls back to standard translation if no relevant context found.
        """
        # Embed the query text
        query_embedding = generate_embedding(text)

        # Retrieve similar translations
        similar = self.vector_store.search(
            query_embedding,
            limit=top_k
        )

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
        prompt = (
            f"Given these previous translations as context for terminology and style:\n\n"
            f"{context}\n\n"
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
        chunks = split_text_for_translation(text)
        stored_ids = []

        for chunk in chunks:
            if not chunk.strip():
                continue
            embedding = generate_embedding(chunk)
            # For ingestion, we don't have translation yet - store source only
            # Translation will be stored when user translates
            metadata = {
                'filename': filename,
                'source_language': source_language,
                'target_language': target_language,
                'type': 'source'
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