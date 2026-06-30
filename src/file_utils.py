import os
from werkzeug.utils import secure_filename

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    """Return True if the file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_file_extension(filename):
    """Extract the lower‑cased extension from a filename."""
    return filename.rsplit('.', 1)[1].lower() if '.' in filename else ''


def get_extracted_text_path(filename):
    from werkzeug.utils import secure_filename
    safe_name = secure_filename(filename)
    base_name, _ = os.path.splitext(safe_name)
    return os.path.join(UPLOAD_FOLDER, f'{base_name}.extracted.txt')


def save_extracted_text(filename, text):
    path = get_extracted_text_path(filename)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)
    return path


def load_extracted_text(filename):
    from src.text_utils import clean_extracted_text
    path = get_extracted_text_path(filename)
    if not os.path.isfile(path):
        return ''
    with open(path, 'r', encoding='utf-8') as handle:
        text = handle.read()
    return clean_extracted_text(text)


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
