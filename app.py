from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import hashlib
import os
import re
import threading
from urllib.parse import quote
import requests

app = Flask(__name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), 'outputs')
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'txt'}
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://192.168.1.3:11434')
DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma4:e2b')
_MODEL_NAME = None

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

processing_status = {}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_file_extension(filename):
    return filename.rsplit('.', 1)[1].lower() if '.' in filename else ''


def get_extracted_text_path(filename):
    safe_name = secure_filename(filename)
    base_name, _ = os.path.splitext(safe_name)
    return os.path.join(app.config['UPLOAD_FOLDER'], f'{base_name}.extracted.txt')


def save_extracted_text(filename, text):
    path = get_extracted_text_path(filename)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)
    return path


def load_extracted_text(filename):
    path = get_extracted_text_path(filename)
    if not os.path.isfile(path):
        return ''
    with open(path, 'r', encoding='utf-8') as handle:
        text = handle.read()
    return clean_extracted_text(text)


def clean_extracted_text(text):
    cleaned = re.sub(r'\(cid:\d+\)', '', text)
    cleaned = re.sub(r'\(cid:[0-9a-fA-F]+\)', '', cleaned)
    return cleaned


def get_translation_cache_path(text, source_lang, target_lang):
    os.makedirs(CACHE_DIR, exist_ok=True)
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


def count_pdf_pages(pdf_path):
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(pdf_path)
        return len(reader.pages)
    except Exception:
        return 0


def extract_pdf_page_text(pdf_path, page_number):
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(pdf_path)
        page = reader.pages[page_number - 1]
        return clean_extracted_text(page.extract_text() or "")
    except Exception as exc:
        raise Exception(f"Failed to extract page {page_number}: {exc}")


def extract_text_from_pdf(pdf_path):
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(pdf_path)
        text = ""
        for i, page in enumerate(reader.pages, 1):
            page_text = clean_extracted_text(page.extract_text() or "")
            text += f"\n\n--- Page {i} ---\n\n{page_text}"
        return text
    except Exception as primary_err:
        try:
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                text = ""
                for i, page in enumerate(pdf.pages, 1):
                    page_text = clean_extracted_text(page.extract_text() or "")
                    text += f"\n\n--- Page {i} ---\n\n{page_text}"
                return text
        except Exception as fallback_err:
            raise Exception(f"Primary extraction failed ({primary_err}); fallback also failed ({fallback_err})")


def extract_pdf_pages_to_file(pdf_path, filename):
    output_path = get_extracted_text_path(filename)
    try:
        from PyPDF2 import PdfReader
        with open(output_path, 'w', encoding='utf-8') as handle:
            reader = PdfReader(pdf_path)
            for i, page in enumerate(reader.pages, 1):
                page_text = clean_extracted_text(page.extract_text() or "")
                handle.write(f"\n\n--- Page {i} ---\n\n{page_text}")
        return output_path
    except Exception as primary_err:
        try:
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                with open(output_path, 'w', encoding='utf-8') as handle:
                    for i, page in enumerate(pdf.pages, 1):
                        page_text = clean_extracted_text(page.extract_text() or "")
                        handle.write(f"\n\n--- Page {i} ---\n\n{page_text}")
                return output_path
        except Exception as fallback_err:
            raise Exception(f"Primary extraction failed ({primary_err}); fallback also failed ({fallback_err})")


def background_extract_pdf(filepath, filename):
    existing_text = load_extracted_text(filename)
    if existing_text.strip():
        processing_status[filename] = {'status': 'ready', 'message': 'PDF ready', 'page_count': count_pdf_pages(filepath)}
        return

    processing_status[filename] = {'status': 'processing', 'message': 'Extracting PDF text...', 'page_count': count_pdf_pages(filepath)}
    try:
        extract_pdf_pages_to_file(filepath, filename)
        processing_status[filename] = {'status': 'ready', 'message': 'PDF ready', 'page_count': count_pdf_pages(filepath)}
    except Exception as exc:
        processing_status[filename] = {'status': 'error', 'message': str(exc), 'page_count': count_pdf_pages(filepath)}


def extract_text_from_docx(docx_path):
    try:
        import docx
        doc = docx.Document(docx_path)
        text = "\n\n".join([para.text for para in doc.paragraphs if para.text.strip()])
        return text
    except Exception as e:
        raise Exception(f"Failed to extract text from DOCX: {str(e)}")


def extract_text_from_txt(txt_path):
    try:
        with open(txt_path, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        try:
            with open(txt_path, 'r', encoding='latin-1') as f:
                return f.read()
        except Exception as e:
            raise Exception(f"Failed to read text file: {str(e)}")
    except Exception as e:
        raise Exception(f"Failed to read text file: {str(e)}")


def split_text_for_translation(text, max_chars=3000):
    pages = re.split(r'\n\n--- Page \d+ ---\n\n', text)
    chunks = []

    for page in pages:
        page = page.strip()
        if not page:
            continue

        paragraphs = re.split(r'\n\s*\n', page)
        current_chunk = []
        current_length = 0

        for paragraph in paragraphs:
            paragraph = paragraph.strip()
            if not paragraph:
                continue

            para_length = len(paragraph)

            if para_length > max_chars:
                sentences = re.split(r'(?<=[.!?।])\s+', paragraph)
                for sentence in sentences:
                    sentence = sentence.strip()
                    if not sentence:
                        continue
                    sent_length = len(sentence)

                    if current_length + sent_length > max_chars and current_chunk:
                        chunks.append('\n\n'.join(current_chunk))
                        current_chunk = []
                        current_length = 0

                    if sent_length > max_chars:
                        words = sentence.split()
                        temp_chunk = []
                        temp_length = 0
                        for word in words:
                            if temp_length + len(word) + 1 > max_chars and temp_chunk:
                                chunks.append('\n'.join(temp_chunk))
                                temp_chunk = []
                                temp_length = 0
                            temp_chunk.append(word)
                            temp_length += len(word) + 1
                        if temp_chunk:
                            chunks.append('\n'.join(temp_chunk))
                    else:
                        current_chunk.append(sentence)
                        current_length += sent_length + 2
                continue

            if current_length + para_length > max_chars and current_chunk:
                chunks.append('\n\n'.join(current_chunk))
                current_chunk = []
                current_length = 0

            current_chunk.append(paragraph)
            current_length += para_length + 2

        if current_chunk:
            chunks.append('\n\n'.join(current_chunk))

    return chunks or [text]


def resolve_model_name(preferred=None):
    global _MODEL_NAME

    preferred = preferred or DEFAULT_MODEL

    try:
        response = requests.get(f'{OLLAMA_URL}/api/tags', timeout=10)
        response.raise_for_status()
        names = [model.get('name') or model.get('model') for model in response.json().get('models', [])]

        if preferred and preferred in names:
            _MODEL_NAME = preferred
        elif preferred:
            match = next((name for name in names if name == preferred or name.startswith(preferred + ':') or name.startswith(preferred)), None)
            _MODEL_NAME = match or _MODEL_NAME

        if not _MODEL_NAME:
            _MODEL_NAME = next((name for name in names if name.lower().startswith('gemma4')), None)

        return _MODEL_NAME or preferred
    except Exception:
        return preferred or _MODEL_NAME or DEFAULT_MODEL


def extract_pages(text):
    page_numbers = [int(number) for number in re.findall(r'--- Page (\d+) ---', text)]
    parts = re.split(r'\n\n--- Page \d+ ---\n\n', text)
    pages = {}

    for index, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue

        page_number = page_numbers[index - 1] if index > 0 else 1
        pages[page_number] = part

    if not pages and text.strip():
        pages[1] = text.strip()

    return pages


def get_page_text(text, page_number):
    try:
        page_number = int(page_number)
    except (TypeError, ValueError):
        raise ValueError('Invalid page number')

    pages = extract_pages(text)

    if page_number not in pages:
        raise ValueError(f'Page {page_number} was not found')

    return pages[page_number]


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
        "options": {
            "temperature": 0.3,
            "num_ctx": 4096
        }
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
        "options": {
            "temperature": 0.5,
            "num_ctx": 4096
        }
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
    page_text = get_page_text(text, page_number)
    return translate_with_ollama(page_text, target_language, source_language)


def translate_full_text(text, target_language, source_language='auto'):
    chunks = split_text_for_translation(text)
    translated_chunks = []

    for chunk in chunks:
        translated = translate_with_ollama(chunk, target_language, source_language)
        translated_chunks.append(translated.strip())

    return '\n\n'.join(translated_chunks)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    ext = get_file_extension(file.filename)
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({'error': f'Unsupported file type. Allowed: {", ".join(sorted(ALLOWED_EXTENSIONS))}'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    try:
        if ext == 'pdf':
            page_count = count_pdf_pages(filepath)
            existing_text = load_extracted_text(filename)
            if existing_text.strip():
                pages = extract_pages(existing_text)
                preview_text = get_page_text(existing_text, 1) if len(pages) >= 1 else existing_text[:4000]
                return jsonify({
                    'success': True,
                    'filename': filename,
                    'text': existing_text,
                    'preview_text': preview_text,
                    'page_count': len(pages),
                    'file_type': ext,
                    'storage_ready': True,
                    'processing': False
                })

            processing_status[filename] = {'status': 'queued', 'message': 'PDF queued for processing', 'page_count': page_count}
            threading.Thread(target=background_extract_pdf, args=(filepath, filename), daemon=True).start()
            return jsonify({
                'success': True,
                'filename': filename,
                'text': '',
                'preview_text': '',
                'page_count': page_count,
                'file_type': ext,
                'storage_ready': False,
                'processing': True
            })

        if ext == 'docx':
            existing_text = load_extracted_text(filename)
            if existing_text.strip():
                text = existing_text
            else:
                text = extract_text_from_docx(filepath)
                text = f"\n\n--- Page 1 ---\n\n{text}"
                save_extracted_text(filename, text)
        elif ext == 'txt':
            existing_text = load_extracted_text(filename)
            if existing_text.strip():
                text = existing_text
            else:
                text = extract_text_from_txt(filepath)
                text = f"\n\n--- Page 1 ---\n\n{text}"
                save_extracted_text(filename, text)
        else:
            return jsonify({'error': 'Unsupported file type'}), 400

        pages = extract_pages(text)
        preview_text = get_page_text(text, 1) if len(pages) >= 1 else text[:4000]
        return jsonify({
            'success': True,
            'filename': filename,
            'text': preview_text,
            'preview_text': preview_text,
            'page_count': len(pages),
            'file_type': ext,
            'storage_ready': True,
            'processing': False
        })
    except Exception as e:
        return jsonify({'error': f'Failed to extract text: {str(e)}'}), 500


@app.route('/api/translate', methods=['POST'])
def translate_text():
    data = request.get_json()
    text = data.get('text', '')
    filename = data.get('filename', '')
    target_language = data.get('target_language', 'English')
    source_language = data.get('source_language', 'auto')

    if filename and not text.strip():
        text = load_extracted_text(filename)

    if not text.strip():
        return jsonify({'error': 'No text provided'}), 400

    try:
        translated = translate_full_text(text, target_language, source_language)
        return jsonify({
            'success': True,
            'translated_text': translated
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/translate-page', methods=['POST'])
def translate_page():
    data = request.get_json()
    text = data.get('text', '')
    filename = data.get('filename', '')
    page_text = data.get('page_text', '')
    page_number = data.get('page_number')
    target_language = data.get('target_language', 'English')
    source_language = data.get('source_language', 'auto')

    if not text.strip() and not page_text.strip() and filename:
        text = load_extracted_text(filename)

    if not text.strip() and not page_text.strip():
        return jsonify({'error': 'No text provided'}), 400

    try:
        if not page_text.strip():
            if filename:
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                ext = get_file_extension(filename)
                if ext == 'pdf' and os.path.isfile(filepath):
                    page_text = extract_pdf_page_text(filepath, int(page_number))
                else:
                    page_text = get_page_text(text, page_number)
            else:
                page_text = get_page_text(text, page_number)
        translated = translate_with_ollama(page_text, target_language, source_language)
        return jsonify({
            'success': True,
            'page_number': int(page_number),
            'translated_text': translated
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/page-text')
def get_page_text_route():
    filename = request.args.get('filename', '')
    page_number = request.args.get('page', 1)

    if not filename:
        return jsonify({'error': 'No filename provided'}), 400

    try:
        text = load_extracted_text(filename)
        if not text.strip():
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            ext = get_file_extension(filename)
            if ext == 'pdf' and os.path.isfile(filepath):
                page_text = extract_pdf_page_text(filepath, int(page_number))
                return jsonify({
                    'success': True,
                    'filename': filename,
                    'page_number': int(page_number),
                    'page_text': page_text
                })
            return jsonify({'error': 'Document text not found'}), 404
        page_text = get_page_text(text, page_number)
        return jsonify({
            'success': True,
            'filename': filename,
            'page_number': int(page_number),
            'page_text': page_text
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/document-status')
def document_status():
    filename = request.args.get('filename', '')
    if not filename:
        return jsonify({'error': 'No filename provided'}), 400

    status = processing_status.get(filename)
    if status:
        return jsonify({
            'success': True,
            'filename': filename,
            'ready': status.get('status') == 'ready',
            'status': status.get('status'),
            'message': status.get('message'),
            'page_count': status.get('page_count', 0)
        })

    text = load_extracted_text(filename)
    if text.strip():
        return jsonify({'success': True, 'filename': filename, 'ready': True, 'status': 'ready', 'message': 'PDF ready', 'page_count': len(extract_pages(text))})

    return jsonify({'success': True, 'filename': filename, 'ready': False, 'status': 'queued', 'message': 'Waiting for processing', 'page_count': 0})


@app.route('/api/summary', methods=['POST'])
def summarize_text():
    data = request.get_json()
    text = data.get('text', '')
    language = data.get('language', 'English')

    if not text.strip():
        return jsonify({'error': 'No text provided'}), 400

    try:
        summary = summarize_with_ollama(text, language)
        return jsonify({'success': True, 'summary': summary})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/models')
def get_models():
    try:
        response = requests.get(f'{OLLAMA_URL}/api/tags', timeout=10)
        response.raise_for_status()
        models = response.json().get('models', [])
        return jsonify({
            'success': True,
            'models': [model.get('name', '') for model in models]
        })
    except Exception as e:
        return jsonify({
            'success': True,
            'models': [],
            'error': str(e)
        })


@app.route('/api/files')
def list_files():
    files = []
    allowed_exts = tuple('.' + ext for ext in ALLOWED_EXTENSIONS)
    for filename in os.listdir(app.config['UPLOAD_FOLDER']):
        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.isfile(path) and filename.lower().endswith(allowed_exts):
            files.append({
                'name': filename,
                'size': os.path.getsize(path),
                'modified': os.path.getmtime(path),
                'file_type': get_file_extension(filename)
            })

    files.sort(key=lambda item: item['modified'], reverse=True)
    return jsonify({
        'success': True,
        'files': files[:10]
    })


@app.route('/api/file/<path:filename>')
def get_file_text(filename):
    safe_name = os.path.basename(filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], safe_name)

    if not os.path.isfile(filepath):
        return jsonify({'error': 'File not found'}), 404

    try:
        ext = get_file_extension(safe_name)
        text = load_extracted_text(safe_name)
        if not text.strip():
            if ext == 'pdf':
                text = extract_text_from_pdf(filepath)
            elif ext == 'docx':
                text = extract_text_from_docx(filepath)
                text = f"\n\n--- Page 1 ---\n\n{text}"
            elif ext == 'txt':
                text = extract_text_from_txt(filepath)
                text = f"\n\n--- Page 1 ---\n\n{text}"
            else:
                return jsonify({'error': 'Unsupported file type'}), 400
            save_extracted_text(safe_name, text)
        
        pages = extract_pages(text)
        return jsonify({
            'success': True,
            'filename': safe_name,
            'text': text,
            'page_count': len(pages),
            'file_type': ext
        })
    except Exception as e:
        return jsonify({'error': f'Failed to extract text: {str(e)}'}), 500


@app.route('/outputs/<filename>')
def serve_output(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename)


@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    safe_name = os.path.basename(filename)
    return send_from_directory(app.config['UPLOAD_FOLDER'], safe_name)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
