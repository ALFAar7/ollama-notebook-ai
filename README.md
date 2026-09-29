# Ollama Notebook
![alt text](image.png)

A local AI-powered reading workspace that translates documents (PDF, DOCX, TXT) and text using Ollama. Supports multiple languages, page-by-page translation, summarization, study notes, RTL layouts, and history management.

## Features

- **Translate Text or Documents**: Upload PDF, DOCX, or TXT files for instant translation
- **Page-by-Page Translation**: Navigate through document pages and translate individually or all at once
- **Readable PDF Preview**: Zoom controls (including fit-to-width) and a preview panel you can resize from any edge or corner
- **Auto-generated Summaries**: Generate summaries in the target language from translated content
- **Study Notes**: Capture key ideas, questions, and follow-up prompts as you study documents
- **History Management**: View, search, filter, delete, and clear translation history with statistics
- **RTL Support**: Full support for Persian, Arabic, Kurdish (Surani) with right-to-left layout across translations, search results, answers, and notes
- **Local Translation Caching**: Faster repeated translations through caching system
- **Multi-Language Support**: Auto-detect source language; translate to English, Arabic, Kurdish, Persian, French, German, Spanish
- **Knowledge Search**: Semantic search over uploaded documents, scoped to the current document or the whole library, with results translated to your target language
- **Instant Search**: Embeddings are held in an in-memory matrix, so queries return in milliseconds instead of scanning the whole database

## Prerequisites

- Python 3.8+
- [Ollama](https://ollama.com/) (local AI model server)

## Installation

### 1. Install Ollama

**Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**macOS:**
```bash
brew install ollama && brew services start ollama
```

**Windows:** Download and install from https://ollama.com/download

After installing, ensure Ollama is running:
```bash
ollama --version
```

### 2. Pull Models

The app uses two models: one for translation, and one for embeddings.

```bash
# Translation model (this is the app's default)
ollama pull gemma4:e2b

# Embedding model (needed by the Knowledge Search / RAG features)
ollama pull nomic-embed-text
```

Verify both are available:
```bash
ollama list
```

> **The embedding model is easy to miss.** If `nomic-embed-text` is missing,
> uploading a document still appears to succeed but the knowledge base stays
> empty — ingestion errors are deliberately swallowed so a failed index does
> not interrupt your upload. Pull it before relying on Search. To use a
> different translation model, set `OLLAMA_MODEL` (see [Configuration](#configuration)).

### 3. Clone and set up this project

```bash
git clone <repository-url>
cd ollama-notebook
```

### 4. Create and activate a virtual environment

```bash
python -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows
```

### 5. Install dependencies

```bash
pip install -r requirements.txt
```

## Configuration

The app reads its settings from **environment variables** using `os.environ`.

> **There is no `.env` loader.** The bundled `.env.example` is a reference
> template only — nothing in the code reads a `.env` file. Copying it to
> `.env` will have no effect until you load those values into the environment
> yourself (`export $(grep -v '^#' .env | xargs)`, `set -a; . ./.env; set +a`,
> or a `direnv`/shell profile). Use one of those, or pass variables inline.

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://192.168.1.3:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `gemma4:e2b` | Model used for translation and chat |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Model used to embed document chunks |
| `OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE` | `50` | Chunks per embedding batch request |
| `VECTOR_STORE_DIR` | `./vector_store` | Directory holding the vector database |
| `VECTOR_COLLECTION` | `translation_embeddings` | Name of the SQLite file inside that directory |
| `VECTOR_SIMILARITY_THRESHOLD` | `0.3` | Minimum cosine similarity for a search hit |
| `CHROMA_DB_DIR` | — | Legacy alias for `VECTOR_STORE_DIR` (used only if the latter is unset) |

**Example:**
```bash
export OLLAMA_URL=http://localhost:11434
export OLLAMA_MODEL=gemma4:e2b
python app.py
```

**Note:** The default `OLLAMA_URL` points at a LAN address. If Ollama runs on the
same machine, set it to `http://localhost:11434` or `http://127.0.0.1:11434`.

## Running the App

```bash
source venv/bin/activate
python app.py
```

Open `http://localhost:5000` in your browser. The app runs in Flask debug mode,
so the server restarts automatically when you edit a file.

## Usage Guide

### Text Mode (Default)
- Type or paste text directly into the translation area
- Choose source and target languages
- Click **Translate** to get instant results
- View translations, copy them, or save as study notes

### Attachment / Document Mode
1. **Upload a document**: Drag and drop a PDF, DOCX, or TXT file into the sidebar
2. **View pages**: Navigate through document pages with previous/next buttons or page number input. For PDFs the viewer follows the page controls, so paging and the preview stay in sync
3. **Adjust the preview**:
   - **Zoom** — use the `-` / percentage / `+` buttons in the corner of the PDF viewer, or **Fit** to scale the page width to the panel. Double-click a resize handle to reset
   - **Resize** — drag any edge or corner handle of the preview to make it larger or smaller. The opposite edge stays put. Handles are keyboard reachable: focus one and use the arrow keys (hold Shift for bigger steps), Enter resets
4. **Translate a page**: Click **Translate Page** to translate the current page
5. **Translate all pages**: Click **Translate All** to process every page at once
6. **Generate summary**: After translation, generate a study notes summary from the content

### History Mode
- View all past translations organized by document and language
- Search history entries with keyword filtering
- Filter by source or target language
- Delete individual entries or clear entire history
- View statistics (total translations, unique documents, languages used)

### Knowledge Search Mode
1. **Upload a document** — uploading indexes its chunks into the knowledge base
2. **Switch to Search** — open the Search tab
3. **Choose a scope** — the toggle next to the search bar switches between **This document** (default, when a document is open) and **All documents**. The Ask box below shares the same scope
4. **Enter a query** — type a question or topic in the search bar
5. **Review results** — the app finds relevant source chunks via semantic search and translates them to your selected target language
6. **Ask a question** — the same scope applies to the Ask box, which returns a written answer with citations
7. **Inspect citations** — each result shows the source filename and page number

All documents live in a single SQLite vector database
(`vector_store/translation_embeddings.db`). Deleting an uploaded file does not
remove its chunks, so re-uploading the same document indexes it again.

## Supported Languages

**Source Languages:** Auto-detect | Arabic | English | French | German | Italian | Kurdish | Persian | Russian | Spanish | Chinese

**Target Languages:** English | Arabic | Kurdish | Persian | French | German | Spanish

## Architecture

- **Backend**: Python Flask API with RESTful endpoints
- **Frontend**: Responsive HTML/CSS/vanilla-JS UI, served from `templates/` and `static/`
- **AI Engine**: Ollama local models for translation and embeddings
- **Search**: Custom SQLite vector store (`src/vector_store.py`) with an in-memory `numpy` similarity matrix, cosine similarity, and metadata filtering
- **Storage**: Local filesystem — `uploads/`, `outputs/`, `history/`, `cache/`, and the `vector_store/` database. All of these are git-ignored and regenerated locally

### Project Layout

```
app.py                  Entry point
src/
  app.py                Flask app + config
  routes.py             HTTP endpoints
  vector_store.py       SQLite vector store + in-memory index
  rag_pipeline.py       Search and question-answering
  ingestion.py          Extract, chunk, embed
  chunking.py           Text chunking
  embedding.py          Ollama embedding calls
  ollama.py             Ollama translate/chat client
  history.py            Translation history
  file_utils.py         Extraction helpers
  pdf_utils.py          PDF text extraction
  text_utils.py         Text utilities
  misc.py               Shared mutable state (in-flight processing status)
templates/              Jinja2 templates
static/                 CSS and JavaScript
```

*Local, private document translation built with Flask, Ollama, and Gemma4.*
