def extract_text_from_pdf(pdf_path):
    """Extract text from PDF file with fallback methods.
    Tries PyPDF2 first; if it raises an exception, falls back to pdfplumber.
    Returns the extracted text or raises the original exception if both fail.
    """
    # Primary method: PyPDF2
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(pdf_path)
        text = ""
        for i, page in enumerate(reader.pages, 1):
            page_text = page.extract_text() or ""
            text += f"\n\n--- Page {i} ---\n\n{page_text}"
        return text
    except Exception as primary_err:
        # Fallback method: pdfplumber
        try:
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                text = ""
                for i, page in enumerate(pdf.pages, 1):
                    page_text = page.extract_text() or ""
                    text += f"\n\n--- Page {i} ---\n\n{page_text}"
                return text
        except Exception as fallback_err:
            # Raise original error with additional context
            raise Exception(f"Primary extraction failed ({primary_err}); fallback also failed ({fallback_err})")
