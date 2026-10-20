#!/usr/bin/env python3
"""
A minimal stand-in for an Ollama server.

Purpose: prove the UI's *success* paths end-to-end (translate -> output renders ->
output actions enable -> history is written) on a machine where the real Ollama is
unreachable. It implements only the two endpoints this app calls:

    GET  /api/tags       -> {"models": [{"name": "gemma4:e2b"}]}
    POST /api/generate   -> {"response": "<deterministic echo>"}

The generate response is a deterministic function of the prompt, so assertions in
the UI test can match on exact text.

Usage:  venv/bin/python tools/mock_ollama.py [port]
Then:   OLLAMA_URL=http://127.0.0.1:<port> venv/bin/python app.py
"""

import json
import os
import re
import sqlite3
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 11435

# Optional artificial latency, so in-flight UI states (loading badges, progress
# bars) are observable. Set MOCK_DELAY=<seconds> before starting the mock.
DELAY = float(os.environ.get("MOCK_DELAY", "0") or 0)

# Persian/Farsi echo so the RTL path is exercised for real.
PERSIAN = {
    "hello": "سلام",
    "world": "جهان",
    "the": "این",
    "quick": "سریع",
    "brown": "قهوه‌ای",
    "fox": "روباه",
    "jumps": "می‌پرد",
    "over": "روی",
    "lazy": "تنبل",
    "dog": "سگ",
}

FAKE_TRANSLATION = "سلام جهان — این یک ترجمه آزمایشی است."
FAKE_ANSWER = "This is a generated answer citing the uploaded document."
FAKE_SUMMARY = "A concise summary of the current translation."


def make_response(prompt: str) -> str:
    """Deterministic pseudo-translation derived from the prompt."""
    if "translate the following text" in prompt.lower():
        match = re.search(r"Text to translate:\s*\n(.+)$", prompt, re.S)
        body = match.group(1).strip() if match else prompt
        words = [w.lower().strip(".,!?") for w in body.split()]
        translated = " ".join(PERSIAN.get(w, w) for w in words)
        return f"{translated}\n\n{FAKE_TRANSLATION}"
    if "summar" in prompt.lower():
        return FAKE_SUMMARY
    return FAKE_ANSWER


def load_stored_vector():
    """A real embedding lifted from the local vector store.

    Serving a genuine stored vector means the query embedding matches an actual
    chunk, so the similarity search returns a real hit (similarity ~1.0) and the
    UI renders genuine result cards. Falls back to a unit vector if the store is
    absent.
    """
    store = Path(__file__).resolve().parent.parent / "vector_store" / "translation_embeddings.db"
    if not store.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
        row = conn.execute("SELECT embedding FROM embeddings LIMIT 1").fetchone()
        conn.close()
        return json.loads(row[0]) if row else None
    except Exception:
        return None


STORED_VECTOR = load_stored_vector()



class Handler(BaseHTTPRequestHandler):
    def _send(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/tags"):
            self._send({"models": [{"name": "gemma4:e2b"}, {"name": "nomic-embed-text:latest"}]})
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            payload = {}
        if self.path.startswith("/api/embed"):
            # Serve a real stored embedding so the query matches an actual chunk.
            raw = payload.get("input", "")
            texts = raw if isinstance(raw, list) else [raw]
            vector = STORED_VECTOR or [1.0] + [0.0] * 767
            self._send({"embeddings": [vector for _ in texts]})
        elif self.path.startswith("/api/generate"):
            prompt = payload.get("prompt", "")
            if DELAY:
                time.sleep(DELAY)
            self._send({"response": make_response(prompt), "done": True})
        else:
            self._send({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        sys.stderr.write("[mock-ollama] " + (fmt % args) + "\n")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"[mock-ollama] listening on http://127.0.0.1:{PORT}\n")
    server.serve_forever()
