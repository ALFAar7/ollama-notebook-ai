#!/usr/bin/env bash
# Boot the app on a free port for UI verification.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-5055}"
export FLASK_ENV=production
exec venv/bin/python -c "
from src.app import app
app.run(host='127.0.0.1', port=${PORT}, debug=False, use_reloader=False)
"
