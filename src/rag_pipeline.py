"""
Knowledge search pipeline: semantic search over uploaded document chunks,
with on-the-fly translation of retrieved results to the user's target language.
"""

from typing import List, Dict
from src.vector_store import VectorStore
from src.embedding import generate_embedding
from src.ollama import translate_with_ollama, generate_with_ollama


class RAGPipeline:
    def __init__(self, vector_store: VectorStore = None):
        self.vector_store = vector_store or VectorStore()

    def search_and_translate(
        self,
        query: str,
        target_language: str,
        source_language: str = 'auto',
        limit: int = 5
    ) -> List[Dict]:
        """
        Semantic search over ingested source chunks and translate each result
        to the user's target language.

        Steps:
          1. Embed the query.
          2. Vector search for relevant source chunks (type: 'source').
          3. Translate each retrieved chunk to target_language.
          4. Return translated results with source citation metadata.
        """
        query_embedding = generate_embedding(query)

        results = self.vector_store.search(
            query_embedding,
            limit=limit,
            entry_type='source'
        )

        translated_results = []
        for item in results:
            source_text = item.get('source_text', '')
            translated = translate_with_ollama(source_text, target_language, source_language)
            metadata = item.get('metadata', {})
            translated_results.append({
                'id': item.get('id'),
                'source_text': source_text,
                'translated_text': translated,
                'similarity': item.get('similarity', 0.0),
                'filename': metadata.get('filename', ''),
                'page_number': metadata.get('page_number'),
                'source_language': metadata.get('source_language', source_language),
                'target_language': target_language,
            })

        return translated_results

    def question_and_answer(
        self,
        query: str,
        target_language: str,
        source_language: str = 'auto',
        filename: str = None,
        limit: int = 5
    ) -> Dict:
        """
        Answer a natural-language question using retrieved document chunks.

        Steps:
          1. Embed the query.
          2. Vector search for relevant source chunks (type: 'source').
          3. Build a prompt with the retrieved context and the user's question.
          4. Generate an answer with Ollama in the target language.
        """
        query_embedding = generate_embedding(query)

        metadata_filter = {'type': 'source'}
        if filename:
            metadata_filter['filename'] = filename

        results = self.vector_store.search(
            query_embedding,
            limit=limit,
            metadata_filter=metadata_filter,
            entry_type='source'
        )

        if not results:
            return {
                'answer': '',
                'sources': [],
                'no_context': True,
            }

        context_chunks = [item.get('source_text', '') for item in results]
        context = '\n\n'.join(context_chunks)[:6000]

        prompt = f"""Answer the following question based on the provided context. If the context does not contain enough information to answer, say so briefly.

Context:
{context}

Question: {query}

Provide a clear, concise answer in {target_language}:
"""

        try:
            answer = generate_with_ollama(
                prompt,
                target_language=target_language,
                temperature=0.3,
                num_ctx=8192,
                timeout=300
            )
        except Exception:
            answer = ''

        sources = []
        for item in results:
            metadata = item.get('metadata', {})
            sources.append({
                'filename': metadata.get('filename', ''),
                'page_number': metadata.get('page_number'),
                'similarity': round(item.get('similarity', 0.0), 4),
                'source_text': item.get('source_text', ''),
            })

        return {
            'answer': answer,
            'sources': sources,
            'no_context': False,
        }

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
