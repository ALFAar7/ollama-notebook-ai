import os
import hashlib
import requests
import json
from src.text_utils import split_text_for_translation
# Import embedding function for vector search support
from src.embedding import generate_embedding as generate_embedding_fn

#OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://192.168.1.3:11434')
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://192.168.1.3:11434')
DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma4:e2b')
#DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2:3b')
_MODEL_NAME = None
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)


def get_translation_cache_path(text, source_lang, target_lang, context=None):
    """
    Generate cache key that includes context if provided.
    """
    key = f"{text}\u0000{source_lang}\u0000{target_lang}"
    if context:
        # Hash context to avoid huge keys
        context_hash = hashlib.sha256(context.encode('utf-8')).hexdigest()
        key = f"{key}\u0000{context_hash}"
    filename = hashlib.sha256(key.encode('utf-8')).hexdigest() + '.txt'
    return os.path.join(CACHE_DIR, filename)


def save_translation_to_cache(path, translated_text):
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(translated_text)


def load_translation_from_cache(path):
    if not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            return handle.read()
    except Exception:
        return None


def resolve_model_name(preferred=None):
    global _MODEL_NAME
    preferred = preferred or DEFAULT_MODEL
    try:
        response = requests.get(f'{OLLAMA_URL}/api/tags', timeout=10)
        response.raise_for_status()
        names = [m.get('name') or m.get('model') for m in response.json().get('models', [])]
        if preferred and preferred in names:
            _MODEL_NAME = preferred
        elif preferred:
            match = next((n for n in names if n == preferred or n.startswith(preferred + ':') or n.startswith(preferred)), None)
            _MODEL_NAME = match or _MODEL_NAME
        if not _MODEL_NAME:
            _MODEL_NAME = next((n for n in names if n.lower().startswith('gemma4')), None)
        return _MODEL_NAME or preferred
    except Exception:
        return preferred or _MODEL_NAME or DEFAULT_MODEL


def translate_with_ollama(text, target_language, source_language='auto', context=None):
    cache_path = get_translation_cache_path(text, source_language, target_language, context)
    cached = load_translation_from_cache(cache_path)
    if cached is not None:
        return cached

    model_name = resolve_model_name(DEFAULT_MODEL)

    # Build prompt with optional context
    if context:
        prompt = f"""Given these previous translations as context for terminology and style:

{context}

Translate the following text from {source_language} to {target_language}.
Maintain the original formatting as much as possible.
Only provide the translation, no explanations.

Text to translate:
{text}"""
    else:
        prompt = f"""Translate the following text from {source_language} to {target_language}.
Maintain the original formatting as much as possible.
Only provide the translation, no explanations.

Text to translate:
{text}"""

    payload = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_ctx": 4096},
    }

    try:
        response = requests.post(f'{OLLAMA_URL}/api/generate', json=payload, timeout=300)
        response.raise_for_status()
        translated = response.json().get('response', '')
        save_translation_to_cache(cache_path, translated)
        return translated
    except requests.exceptions.ConnectionError:
        raise Exception("Could not connect to Ollama. Make sure Ollama is running on 192.168.1.3:11434")
    except requests.exceptions.Timeout:
        raise Exception("Translation timed out. Try shorter text or increase timeout.")
    except Exception as e:
        raise Exception(f"Translation failed: {str(e)}")


def generate_with_ollama(prompt, target_language='English', temperature=0.3, num_ctx=8192, timeout=300):
    """Generate a response from Ollama using an arbitrary prompt."""
    model_name = resolve_model_name(DEFAULT_MODEL)

    payload = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature, "num_ctx": num_ctx},
    }

    try:
        response = requests.post(f'{OLLAMA_URL}/api/generate', json=payload, timeout=timeout)
        response.raise_for_status()
        return response.json().get('response', '').strip()
    except requests.exceptions.ConnectionError:
        raise Exception("Could not connect to Ollama. Make sure Ollama is running.")
    except requests.exceptions.Timeout:
        raise Exception("Request timed out. Try a shorter query or increase timeout.")
    except Exception as e:
        raise Exception(f"Generation failed: {str(e)}")


def generate_embedding(text):
    """
    Generate embedding for text using Ollama's embedding API.
    Wrapper around embedding module for consistency.
    """
    return generate_embedding_fn(text)


def generate_embeddings(texts):
    """
    Generate embeddings for a list of texts.
    Wrapper around embedding module.
    """
    from src.embedding import generate_embeddings as generate_embeddings_batch
    return generate_embeddings_batch(texts)


def mean_pool_embeddings(embeddings):
    """
    Mean-pool a list of embedding vectors into a single vector.
    Wrapper around embedding module.
    """
    from src.embedding import mean_pool_embeddings as mean_pool_fn
    return mean_pool_fn(embeddings)


def summarize_with_ollama(text, language):
    if not text.strip():
        return ''

    model_name = resolve_model_name(DEFAULT_MODEL)
    if len(text) > 6000:
        text = text[:6000] + '\n\n[...truncated...]'

    prompt = f"""Read the following text and write a short summary in {language}.
Write only in {language}. Do not use any other language.
The summary should be 2-4 sentences and capture the main topic and key points.

Text to summarize:
{text}"""

    payload = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.5, "num_ctx": 4096},
    }

    try:
        response = requests.post(f'{OLLAMA_URL}/api/generate', json=payload, timeout=300)
        response.raise_for_status()
        return response.json().get('response', '').strip()
    except requests.exceptions.ConnectionError:
        raise Exception("Could not connect to Ollama. Make sure Ollama is running on 192.168.1.3:11434")
    except requests.exceptions.Timeout:
        raise Exception("Summary timed out.")
    except Exception as e:
        raise Exception(f"Summary failed: {str(e)}")


def translate_page_text(text, page_number, target_language, source_language='auto'):
    from src.text_utils import get_page_text
    page_text = get_page_text(text, page_number)
    return translate_with_ollama(page_text, target_language, source_language)


def translate_full_text(text, target_language, source_language='auto'):
    chunks = split_text_for_translation(text)
    translated_chunks = []
    for chunk in chunks:
        translated = translate_with_ollama(chunk, target_language, source_language)
        translated_chunks.append(translated.strip())
    return '\n\n'.join(translated_chunks)
