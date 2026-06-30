import os
import hashlib
import requests
from src.text_utils import split_text_for_translation

OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://192.168.1.3:11434')
DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma4:e2b')
_MODEL_NAME = None
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)


def get_translation_cache_path(text, source_lang, target_lang):
    key = f"{text}\u0000{source_lang}\u0000{target_lang}"
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


def translate_with_ollama(text, target_language, source_language='auto'):
    cache_path = get_translation_cache_path(text, source_language, target_language)
    cached = load_translation_from_cache(cache_path)
    if cached is not None:
        return cached

    model_name = resolve_model_name(DEFAULT_MODEL)

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
