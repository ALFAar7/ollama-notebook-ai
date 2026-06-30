import os
from src.file_utils import load_extracted_text, get_extracted_text_path, save_extracted_text
from src.text_utils import clean_extracted_text
from src.text_utils import extract_pages
from src.misc import processing_status


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
        extract_text_from_pdf(filepath)
        processing_status[filename] = {'status': 'ready', 'message': 'PDF ready', 'page_count': count_pdf_pages(filepath)}
    except Exception as exc:
        processing_status[filename] = {'status': 'error', 'message': str(exc), 'page_count': count_pdf_pages(filepath)}
