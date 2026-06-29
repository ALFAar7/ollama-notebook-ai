from flask import Blueprint, request, jsonify, render_template, send_from_directory, current_app as app
import os
import threading
from src.file_utils import (
    allowed_file,
    get_file_extension,
    get_extracted_text_path,
    save_extracted_text,
    load_extracted_text,
    extract_text_from_docx,
    extract_text_from_txt,
)
from src.text_utils import clean_extracted_text
from src.text_utils import split_text_for_translation, extract_pages, get_page_text
from src.ollama import translate_with_ollama, summarize_with_ollama, resolve_model_name
from src.misc import processing_status
from src.pdf_utils import (
    count_pdf_pages,
    extract_pdf_page_text,
    extract_text_from_pdf,
    extract_pdf_pages_to_file,
    background_extract_pdf,
)

bp = Blueprint('api', __name__)


@bp.route('/')
def index():
    return render_template('index.html')


@bp.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


@bp.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    ext = get_file_extension(file.filename)
    if ext not in {'pdf', 'docx', 'txt'}:
        return jsonify({'error': f'Unsupported file type. Allowed: pdf, docx, txt'}), 400

    filename = __import__('werkzeug.utils').utils.secure_filename(file.filename)
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


@bp.route('/api/translate', methods=['POST'])
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
        chunks = split_text_for_translation(text)
        translated_chunks = []
        for chunk in chunks:
            translated = translate_with_ollama(chunk, target_language, source_language)
            translated_chunks.append(translated.strip())

        return jsonify({
            'success': True,
            'translated_text': '\n\n'.join(translated_chunks)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/translate-page', methods=['POST'])
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


@bp.route('/api/page-text')
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


@bp.route('/api/document-status')
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


@bp.route('/api/summary', methods=['POST'])
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


@bp.route('/api/ollama-status')
def ollama_status():
    try:
        import requests
        response = requests.get(f'{os.environ.get("OLLAMA_URL", "http://192.168.1.3:11434")}/api/tags', timeout=5)
        response.raise_for_status()
        return jsonify({'ollama_online': True})
    except Exception:
        return jsonify({'ollama_online': False})


@bp.route('/api/models')
def get_models():
    try:
        import requests
        response = requests.get(f'{os.environ.get("OLLAMA_URL", "http://192.168.1.3:11434")}/api/tags', timeout=10)
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


@bp.route('/api/files')
def list_files():
    files = []
    allowed_exts = tuple('.' + ext for ext in {'pdf', 'docx', 'txt'})
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


@bp.route('/api/file/<path:filename>')
def get_file_text(filename):
    import werkzeug.utils
    safe_name = werkzeug.utils.secure_filename(filename)
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


@bp.route('/outputs/<filename>')
def serve_output(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename)


@bp.route('/uploads/<path:filename>')
def serve_upload(filename):
    import werkzeug.utils
    safe_name = werkzeug.utils.secure_filename(filename)
    return send_from_directory(app.config['UPLOAD_FOLDER'], safe_name)
