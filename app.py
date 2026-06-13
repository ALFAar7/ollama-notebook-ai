from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import os
import re
import requests

app = Flask(__name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), 'outputs')
ALLOWED_EXTENSIONS = {'pdf'}
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma4')

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


def translate_with_ollama(text, target_language, source_language='auto'):
    prompt = f"""Translate the following text from {source_language} to {target_language}.
Maintain the original formatting as much as possible.
Only provide the translation, no explanations.

Text to translate:
{text}"""

    payload = {
        "model": DEFAULT_MODEL,
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
        raise Exception("Could not connect to Ollama. Make sure Ollama is running on localhost:11434")
    except requests.exceptions.Timeout:
        raise Exception("Translation timed out. Try shorter text or increase timeout.")
    except Exception as e:
        raise Exception(f"Translation failed: {str(e)}")


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
        return jsonify({
            'success': True,
            'filename': filename,
            'text': text
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


@app.route('/outputs/<filename>')
def serve_output(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
