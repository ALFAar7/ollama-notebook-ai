"""
Document ingestion: extract text, chunk, embed, and store source chunks.
"""

import os
from src.embedding import generate_embedding
from src.rag_pipeline import get_pipeline
from src.text_utils import split_text_for_translation
from src.misc import processing_status


def extract_and_embed(filepath, filename, source_language='auto', target_language='English'):
    """
    Extract text from document and ingest (chunk + embed) in one pass.
    Returns list of stored vector IDs.
    """
    from src.file_utils import load_extracted_text, extract_text_from_pdf, extract_text_from_docx, extract_text_from_txt
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext == 'pdf':
        text = load_extracted_text(filename)
        if not text.strip():
            text = extract_text_from_pdf(filepath)
    elif ext == 'docx':
        text = load_extracted_text(filename)
        if not text.strip():
            text = extract_text_from_docx(filepath)
            text = f"\n\n--- Page 1 ---\n\n{text}"
    elif ext == 'txt':
        text = load_extracted_text(filename)
        if not text.strip():
            text = extract_text_from_txt(filepath)
            text = f"\n\n--- Page 1 ---\n\n{text}"
    else:
        text = ''

    if not text or not text.strip():
        return []

    pipeline = get_pipeline()
    from src.chunking import chunk_for_translation
    chunks = chunk_for_translation(text)
    stored_ids = []

    for index, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
        embedding = generate_embedding(chunk)
        metadata = {
            'filename': filename,
            'source_language': source_language,
            'target_language': target_language,
            'type': 'source',
            'chunk_index': index,
        }
        stored_ids.append(
            pipeline.vector_store.add(
                source_text=chunk,
                translation='',
                embedding=embedding,
                metadata=metadata
            )
        )

    return stored_ids


def ingest_text(filename, text, source_language='auto', target_language='English', status_key=None):
    """
    Ingest extracted document text into the vector store.
    Returns count of stored chunks.
    """
    if not text or not text.strip():
        return 0

    pipeline = get_pipeline()
    chunks = split_text_for_translation(text)
    stored_ids = []

    for index, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
        page_number = _extract_page_number(chunk)
        embedding = generate_embedding(chunk)
        metadata = {
            'filename': filename,
            'source_language': source_language,
            'target_language': target_language,
            'type': 'source',
            'chunk_index': index,
            'page_number': page_number,
            'status_key': status_key
        }
        stored_ids.append(
            pipeline.vector_store.add(
                source_text=chunk,
                translation='',
                embedding=embedding,
                metadata=metadata
            )
        )

    if status_key:
        processing_status[status_key] = {
            'status': 'ready',
            'message': 'RAG embeddings ready',
            'page_count': len(chunks)
        }

    return len(stored_ids)


def _extract_page_number(text):
    import re
    match = re.search(r'--- Page (\d+) ---', text)
    if match:
        return int(match.group(1))
    return None


def ingest_document(filepath, filename, source_language='auto', target_language='English'):
    """
    Extract document text and ingest it into the vector store.
    """
    from src.file_utils import load_extracted_text, get_extracted_text_path
    from src.pdf_utils import extract_text_from_pdf
    from src.file_utils import extract_text_from_docx, extract_text_from_txt

    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext == 'pdf':
        text = load_extracted_text(filename)
        if not text.strip():
            text = extract_text_from_pdf(filepath)
    elif ext == 'docx':
        text = load_extracted_text(filename)
        if not text.strip():
            text = extract_text_from_docx(filepath)
            text = f"\n\n--- Page 1 ---\n\n{text}"
    elif ext == 'txt':
        text = load_extracted_text(filename)
        if not text.strip():
            text = extract_text_from_txt(filepath)
            text = f"\n\n--- Page 1 ---\n\n{text}"
    else:
        text = ''

    return ingest_text(filename, text, source_language, target_language)