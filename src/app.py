import os

from flask import Flask
from src.history import HistoryManager

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    template_folder=os.path.join(PROJECT_ROOT, '..', 'templates'),
    static_folder=os.path.join(PROJECT_ROOT, '..', 'static'),
)

UPLOAD_FOLDER = os.path.join(PROJECT_ROOT, '..', 'uploads')
OUTPUT_FOLDER = os.path.join(PROJECT_ROOT, '..', 'outputs')
HISTORY_FOLDER = os.path.join(PROJECT_ROOT, '..', 'history')
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'txt'}
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://192.168.1.3:11434')
DEFAULT_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma4:e2b')
_MODEL_NAME = None

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
app.config['HISTORY_FOLDER'] = HISTORY_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)
os.makedirs(HISTORY_FOLDER, exist_ok=True)
CACHE_DIR = os.path.join(PROJECT_ROOT, '..', 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

app.config['CACHE_DIR'] = CACHE_DIR

# Initialize history manager
history_manager = HistoryManager(HISTORY_FOLDER)
app.config['HISTORY_MANAGER'] = history_manager

from src.routes import bp as api_bp
app.register_blueprint(api_bp)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
