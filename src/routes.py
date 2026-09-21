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
from src.rag_pipeline import get_pipeline
from src.ingestion import ingest_document
from src.embedding import generate_embedding

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

        try:
            ingest_document(filepath, filename)
        except Exception:
            pass

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
        enable_rag = os.environ.get('ENABLE_RAG', 'true').lower() == 'true'

        if enable_rag:
            pipeline = get_pipeline()
            translated_text = pipeline.translate_with_context(
                text=text,
                target_language=target_language,
                source_language=source_language
            )
            pipeline.store_translation(
                source_text=text,
                translated_text=translated_text,
                source_language=source_language,
                target_language=target_language,
                filename=filename if filename else None,
                mode='text' if not filename else 'document'
            )
        else:
            chunks = split_text_for_translation(text)
            translated_chunks = []
            for chunk in chunks:
                translated = translate_with_ollama(chunk, target_language, source_language)
                translated_chunks.append(translated.strip())
            translated_text = '\n\n'.join(translated_chunks)

        # Save to history
        try:
            history_manager = app.config['HISTORY_MANAGER']
            history_manager.add_entry(
                source_text=text,
                translated_text=translated_text,
                source_language=source_language,
                target_language=target_language,
                mode='text' if not filename else 'document',
                filename=filename
            )
        except Exception:
            pass  # Don't fail translation if history fails

        return jsonify({
            'success': True,
            'translated_text': translated_text
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
        
        # Save to history
        try:
            history_manager = app.config['HISTORY_MANAGER']
            history_manager.add_entry(
                source_text=page_text,
                translated_text=translated,
                source_language=source_language,
                target_language=target_language,
                mode='page',
                filename=filename,
                page_number=int(page_number)
            )
        except Exception:
            pass  # Don't fail translation if history fails
        
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


# History API routes
@bp.route('/api/history', methods=['GET'])
def get_history():
    """Get translation history with optional pagination and search."""
    try:
        history_manager = app.config['HISTORY_MANAGER']
        
        # Get query parameters
        limit = int(request.args.get('limit', 50))
        skip = int(request.args.get('skip', 0))
        search_query = request.args.get('q', '').strip()
        
        if search_query:
            entries = history_manager.search_history(search_query, limit)
        else:
            entries = history_manager.get_history(limit, skip)
        
        return jsonify({
            'success': True,
            'entries': entries,
            'count': len(entries)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/api/history', methods=['POST'])
def add_history_entry():
    """Add a new translation to history."""
    try:
        history_manager = app.config['HISTORY_MANAGER']
        data = request.get_json()
        
        entry = history_manager.add_entry(
            source_text=data.get('source_text', ''),
            translated_text=data.get('translated_text', ''),
            source_language=data.get('source_language', 'auto'),
            target_language=data.get('target_language', 'English'),
            mode=data.get('mode', 'text'),
            filename=data.get('filename'),
            page_number=data.get('page_number'),
            summary=data.get('summary')
        )
        
        return jsonify({
            'success': True,
            'entry': entry
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/api/history/<entry_id>', methods=['GET'])
def get_history_entry(entry_id):
    """Get a specific history entry."""
    try:
        history_manager = app.config['HISTORY_MANAGER']
        entry = history_manager.get_entry(entry_id)
        
        if entry:
            return jsonify({
                'success': True,
                'entry': entry
            })
        else:
            return jsonify({'success': False, 'error': 'Entry not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/api/history/<entry_id>', methods=['DELETE'])
def delete_history_entry(entry_id):
    """Delete a specific history entry."""
    try:
        history_manager = app.config['HISTORY_MANAGER']
        success = history_manager.delete_entry(entry_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Entry deleted'
            })
        else:
            return jsonify({'success': False, 'error': 'Entry not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/api/history/clear', methods=['POST'])
def clear_history():
    """Clear all history entries."""
    try:
        history_manager = app.config['HISTORY_MANAGER']
        success = history_manager.clear_history()
        
        return jsonify({
            'success': success,
            'message': 'History cleared' if success else 'Failed to clear history'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/api/history/stats', methods=['GET'])
def get_history_stats():
    """Get history statistics."""
    try:
        history_manager = app.config['HISTORY_MANAGER']
        stats = history_manager.get_stats()

        return jsonify({
            'success': True,
            'stats': stats
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@bp.route('/api/translation-cache', methods=['GET'])
def get_translation_cache():
    """Check if a translation exists in cache for a specific page and language."""
    filename = request.args.get('filename', '')
    page = int(request.args.get('page', 1))
    target_language = request.args.get('target_language', 'English')

    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    try:
        history_manager = app.config['HISTORY_MANAGER']
        history = history_manager.get_history()

        # Search for matching translation in history
        for entry in history:
            if (entry.get('filename') == filename and
                entry.get('page_number') == page and
                entry.get('target_language') == target_language and
                entry.get('mode') == 'page'):

                # Get the full translation text
                full_translation = history_manager.get_full_translation(
                    entry.get('full_text_id'),
                    filename,
                    page,
                    target_language
                )

                if full_translation:
                    return jsonify({
                        'success': True,
                        'translated_text': full_translation
                    })
                else:
                    # Fallback to preview text if full text not found
                    return jsonify({
                        'success': True,
                        'translated_text': entry.get('translated_text', '')
                    })

        return jsonify({'success': False, 'error': 'Translation not found in cache'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# RAG-enhanced endpoints
@bp.route('/api/rag-translate', methods=['POST'])
def rag_translate():
    """RAG-enhanced translation with context retrieval from vector store."""
    data = request.get_json()
    text = data.get('text', '')
    filename = data.get('filename', '')
    target_language = data.get('target_language', 'English')
    source_language = data.get('source_language', 'auto')
    enable_rag = data.get('enable_rag', os.environ.get('ENABLE_RAG', 'true').lower() == 'true')

    if filename and not text.strip():
        text = load_extracted_text(filename)

    if not text.strip():
        return jsonify({'error': 'No text provided'}), 400

    try:
        if enable_rag:
            pipeline = get_pipeline()
            translated_text = pipeline.translate_with_context(
                text=text,
                target_language=target_language,
                source_language=source_language
            )
        else:
            chunks = split_text_for_translation(text)
            translated_chunks = []
            for chunk in chunks:
                translated = translate_with_ollama(chunk, target_language, source_language)
                translated_chunks.append(translated.strip())
            translated_text = '\n\n'.join(translated_chunks)

        # Store translation with embedding for future retrieval
        if enable_rag:
            pipeline = get_pipeline()
            pipeline.store_translation(
                source_text=text,
                translated_text=translated_text,
                source_language=source_language,
                target_language=target_language,
                filename=filename
            )

        # Save to history
        try:
            history_manager = app.config['HISTORY_MANAGER']
            history_manager.add_entry(
                source_text=text,
                translated_text=translated_text,
                source_language=source_language,
                target_language=target_language,
                mode='text' if not filename else 'document',
                filename=filename
            )
        except Exception:
            pass

        return jsonify({
            'success': True,
            'translated_text': translated_text,
            'rag_enabled': enable_rag
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/search', methods=['GET'])
def semantic_search():
    """Semantic search over stored translations using vector similarity."""
    query = request.args.get('q', '')
    limit = int(request.args.get('limit', 5))
    target_language = request.args.get('target_language', '')

    if not query.strip():
        return jsonify({'error': 'Search query required'}), 400

    try:
        pipeline = get_pipeline()
        query_embedding = generate_embedding(query)
        metadata_filter = {}
        if target_language:
            metadata_filter['target_language'] = target_language

        results = pipeline.vector_store.search(
            query_embedding,
            limit=limit,
            metadata_filter=metadata_filter if metadata_filter else None
        )

        formatted_results = []
        for item in results:
            formatted_results.append({
                'id': item['id'],
                'source_text': item['source_text'],
                'translated_text': item['translated_text'],
                'similarity': item['similarity'],
                'filename': item['metadata'].get('filename', ''),
                'page_number': item['metadata'].get('page_number'),
                'source_language': item['metadata'].get('source_language', ''),
                'target_language': item['metadata'].get('target_language', '')
            })

        return jsonify({
            'success': True,
            'results': formatted_results,
            'count': len(formatted_results)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/similar', methods=['GET'])
def find_similar():
    """Find similar translations by filename and page."""
    filename = request.args.get('filename', '')
    page = request.args.get('page', '1')
    limit = int(request.args.get('limit', 5))

    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    try:
        pipeline = get_pipeline()
        full_text = load_extracted_text(filename)
        
        if not full_text.strip():
            return jsonify({'error': 'Document text not found'}), 404
        
        # Get page text if page specified
        pages = extract_pages(full_text)
        page_text = pages.get(int(page), full_text)
        
        # Generate embedding and search
        query_embedding = generate_embedding(page_text)
        metadata_filter = {'filename': filename, 'page_number': int(page)}
        
        results = pipeline.vector_store.search(
            query_embedding,
            limit=limit,
            metadata_filter=metadata_filter
        )

        formatted_results = []
        for item in results:
            formatted_results.append({
                'id': item['id'],
                'source_text': item['source_text'],
                'translated_text': item['translated_text'],
                'similarity': item['similarity'],
                'filename': item['metadata'].get('filename', ''),
                'page_number': item['metadata'].get('page_number'),
                'source_language': item['metadata'].get('source_language', ''),
                'target_language': item['metadata'].get('target_language', '')
            })

        return jsonify({
            'success': True,
            'results': formatted_results,
            'count': len(formatted_results)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Hybrid search endpoint
@bp.route('/api/hybrid-search', methods=['GET'])
def hybrid_search():
    """Combined vector and text search over translations."""
    query = request.args.get('q', '')
    limit = int(request.args.get('limit', 5))
    vector_weight = float(request.args.get('vector_weight', '0.7'))
    text_weight = float(request.args.get('text_weight', '0.3'))
    target_language = request.args.get('target_language', '')

    if not query.strip():
        return jsonify({'error': 'Search query required'}), 400

    try:
        pipeline = get_pipeline()
        query_embedding = generate_embedding(query)
        
        vector_results = pipeline.vector_store.search(
            query_embedding,
            limit=limit,
            metadata_filter={'target_language': target_language} if target_language else None
        )

        formatted_results = []
        for item in vector_results:
            formatted_results.append({
                'id': item['id'],
                'source_text': item['source_text'],
                'translated_text': item['translated_text'],
                'similarity': item['similarity'],
                'filename': item['metadata'].get('filename', ''),
                'page_number': item['metadata'].get('page_number'),
                'source_language': item['metadata'].get('source_language', ''),
                'target_language': item['metadata'].get('target_language', '')
            })

        return jsonify({
            'success': True,
            'results': formatted_results,
            'count': len(formatted_results),
            'search_type': 'hybrid',
            'vector_weight': vector_weight,
            'text_weight': text_weight
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/vector-stats', methods=['GET'])
def vector_stats():
    """Get vector store statistics."""
    try:
        pipeline = get_pipeline()
        vector_store = pipeline.vector_store
        conn = vector_store._connect()
        count = conn.execute('SELECT COUNT(*) FROM embeddings').fetchone()[0]
        conn.close()
        return jsonify({
            'success': True,
            'stats': {
                'total_embeddings': count,
                'collection_name': vector_store.collection_name,
                'db_path': vector_store.db_path,
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
