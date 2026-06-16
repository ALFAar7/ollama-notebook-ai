from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import os
import re
from urllib.parse import quote
import requests

app = Flask(__name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), 'outputs')
ALLOWED_EXTENSIONS = {'pdf'}
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://192.168.1.3:11434')
DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma4:e2b')
_MODEL_NAME = None

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def extract_text_from_pdf(pdf_path):
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(pdf_path)
        text = ""
        for i, page in enumerate(reader.pages, 1):
            page_text = page.extract_text() or ""
            text += f"\n\n--- Page {i} ---\n\n{page_text}"
        return text
    except Exception as primary_err:
        try:
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                text = ""
                for i, page in enumerate(pdf.pages, 1):
                    page_text = page.extract_text() or ""
                    text += f"\n\n--- Page {i} ---\n\n{page_text}"
                return text
        except Exception as fallback_err:
            raise Exception(f"Primary extraction failed ({primary_err}); fallback also failed ({fallback_err})")


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
        return response.json().get('response', '')
    except requests.exceptions.ConnectionError:
        raise Exception("Could not connect to Ollama. Make sure Ollama is running on 192.168.1.3:11434")
    except requests.exceptions.Timeout:
        raise Exception("Translation timed out. Try shorter text or increase timeout.")
    except Exception as e:
        raise Exception(f"Translation failed: {str(e)}")


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

    if not allowed_file(file.filename):
        return jsonify({'error': 'Only PDF files are allowed'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    try:
        text = extract_text_from_pdf(filepath)
        pages = extract_pages(text)
        return jsonify({
            'success': True,
            'filename': filename,
            'text': text,
            'page_count': len(pages)
        })
    except Exception as e:
        return jsonify({'error': f'Failed to extract text from PDF: {str(e)}'}), 500


@app.route('/api/translate', methods=['POST'])
def translate_text():
    data = request.get_json()
    text = data.get('text', '')
    target_language = data.get('target_language', 'English')
    source_language = data.get('source_language', 'auto')

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
    page_text = data.get('page_text', '')
    page_number = data.get('page_number')
    target_language = data.get('target_language', 'English')
    source_language = data.get('source_language', 'auto')

    if not text.strip() and not page_text.strip():
        return jsonify({'error': 'No text provided'}), 400

    try:
        if not page_text.strip():
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
        return jsonify({'error': str(e)}), 500


@app.route('/api/files')
def list_files():
    files = []
    for filename in os.listdir(app.config['UPLOAD_FOLDER']):
        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.isfile(path) and filename.lower().endswith('.pdf'):
            files.append({
                'name': filename,
                'size': os.path.getsize(path),
                'modified': os.path.getmtime(path)
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
        text = extract_text_from_pdf(filepath)
        pages = extract_pages(text)
        return jsonify({
            'success': True,
            'filename': safe_name,
            'text': text,
            'page_count': len(pages)
        })
    except Exception as e:
        return jsonify({'error': f'Failed to extract text from PDF: {str(e)}'}), 500


@app.route('/outputs/<filename>')
def serve_output(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename)


@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    safe_name = os.path.basename(filename)
    return send_from_directory(app.config['UPLOAD_FOLDER'], safe_name)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
