"""
Embedding generation using Ollama's embedding API.
Provides single and batch embedding with retry logic.
"""

import os
import time
import json
import requests
from typing import List, Union

OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://192.168.1.3:11434')
OLLAMA_EMBEDDING_MODEL = os.environ.get('OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text')
EMBEDDING_BATCH_SIZE = int(os.environ.get('OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE', '50'))


def _ollama_embed(payload: dict) -> List[float]:
    """Call Ollama embedding API and return embedding vector."""
    try:
        response = requests.post(
            f'{OLLAMA_URL}/api/embed',
            json=payload,
            timeout=60
        )
        response.raise_for_status()
        data = response.json()
        # Ollama returns {"embeddings": [[...]], ...}
        embeddings = data.get('embeddings', [])
        if not embeddings:
            raise ValueError('No embeddings returned from Ollama')
        # For single input, embeddings is list of one vector
        return embeddings[0] if len(embeddings) == 1 else embeddings
    except requests.exceptions.RequestException as e:
        raise Exception(f'Ollama embedding request failed: {str(e)}')


def generate_embedding(text: str) -> List[float]:
    """
    Generate embedding for a single text.
    Retries up to 3 times with 2-second delay.
    """
    payload = {
        "model": OLLAMA_EMBEDDING_MODEL,
        "input": text
    }
    last_error = None
    for attempt in range(3):
        try:
            return _ollama_embed(payload)
        except Exception as e:
            last_error = e
            if attempt < 2:  # not last attempt
                time.sleep(2)
    raise last_error


def generate_embeddings(texts: List[str]) -> List[List[float]]:
    """
    Generate embeddings for a list of texts.
    Processes in batches defined by EMBEDDING_BATCH_SIZE.
    """
    all_embeddings = []
    for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[i:i + EMBEDDING_BATCH_SIZE]
        payload = {
            "model": OLLAMA_EMBEDDING_MODEL,
            "input": batch
        }
        last_error = None
        for attempt in range(3):
            try:
                batch_embeddings = _ollama_embed(payload)
                # _ollama_embed returns list of vectors when input is list
                all_embeddings.extend(batch_embeddings)
                break
            except Exception as e:
                last_error = e
                if attempt < 2:
                    time.sleep(2)
        else:
            raise last_error
    return all_embeddings


def mean_pool_embeddings(embeddings: List[List[float]]) -> List[float]:
    """
    Mean-pool a list of embedding vectors into a single vector.
    Used for document-level embedding from chunk embeddings.
    """
    if not embeddings:
        return []
    length = len(embeddings[0])
    pooled = [0.0] * length
    for vec in embeddings:
        if len(vec) != length:
            raise ValueError('All embeddings must have same dimension')
        for i, val in enumerate(vec):
            pooled[i] += val
    return [val / len(embeddings) for val in pooled]