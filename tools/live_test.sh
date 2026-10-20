#!/usr/bin/env bash
# Live end-to-end test against a REAL Ollama.
#
# Usage:
#   OLLAMA_URL=http://<your-ollama-host>:11434 bash tools/live_test.sh
#
# Exercises every endpoint the refactored UI depends on, so the frontend contract
# is proven against the real model rather than a stub. With no OLLAMA_URL set, the
# script starts the mock Ollama (tools/mock_ollama.py) so the contract can still be
# exercised offline.
#
# Env overrides: APP_PORT, OLLAMA_PORT, MOCK_DELAY.

set -uo pipefail
cd "$(dirname "$0")/.."

APP_PORT="${APP_PORT:-5058}"
OLLAMA_PORT="${OLLAMA_PORT:-11436}"
MOCK_PID=""
APP_PID=""

cleanup() {
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
}
trap cleanup EXIT

# Make sure a stale server on this port cannot be mistaken for ours.
if ss -ltn 2>/dev/null | grep -q ":${APP_PORT} "; then
  echo "ERROR: port ${APP_PORT} is already in use. Set APP_PORT to a free port." >&2
  exit 2
fi

# `requests` does not understand CIDR in no_proxy (e.g. 127.0.0.0/8) and would send
# local Ollama traffic through the HTTP proxy. Pin plain hosts.
export no_proxy="localhost,127.0.0.1${no_proxy:+,$no_proxy}"
export NO_PROXY="$no_proxy"

if [ -z "${OLLAMA_URL:-}" ]; then
  echo "OLLAMA_URL not set - starting the mock Ollama on :${OLLAMA_PORT}"
  venv/bin/python tools/mock_ollama.py "$OLLAMA_PORT" >/tmp/mock_ollama.log 2>&1 &
  MOCK_PID=$!
  sleep 2
  export OLLAMA_URL="http://127.0.0.1:${OLLAMA_PORT}"
fi

echo "Using OLLAMA_URL=${OLLAMA_URL}  app port ${APP_PORT}"
OLLAMA_URL="$OLLAMA_URL" bash tools/serve.sh "$APP_PORT" >/tmp/live_test_app.log 2>&1 &
APP_PID=$!
sleep 5

# Fail loudly if the app did not actually start.
if ss -ltn 2>/dev/null | grep -q ":${APP_PORT} "; then
  :
else
  echo "ERROR: the app did not start on port ${APP_PORT}. Log:" >&2
  tail -20 /tmp/live_test_app.log >&2
  exit 2
fi

BASE="http://127.0.0.1:${APP_PORT}"
PASS=0
FAIL=0

check() {
  local label="$1"; local needle="$2"; local haystack="$3"
  # Flask emits compact JSON ({"success":true}); compare with spaces stripped so
  # the needles stay readable.
  needle="${needle// /}"
  haystack="${haystack// /}"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    printf '  PASS  %-46s %s\n' "$label" "$needle"; PASS=$((PASS+1))
  else
    printf '  FAIL  %-46s missing %s\n' "$label" "$needle"
    printf '        got: %s\n' "$(printf '%s' "${haystack// /}" | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

echo
echo "== Ollama reachability =="
check "ollama-status reports online" '"ollama_online": true' "$(curl -s "$BASE/api/ollama-status")"
check "models endpoint lists a model" '"models":' "$(curl -s "$BASE/api/models")"

echo
echo "== Translation (text mode) =="
TR=$(curl -s -X POST "$BASE/api/translate" -H 'Content-Type: application/json' \
  -d '{"text":"Hello world the quick brown fox","source_language":"English","target_language":"Persian"}')
check "translate returns success" '"success": true' "$TR"
check "translate returns translated_text" '"translated_text"' "$TR"

echo
echo "== Summary (notes mode) =="
SUM=$(curl -s -X POST "$BASE/api/summary" -H 'Content-Type: application/json' \
  -d '{"text":"Hello world the quick brown fox","language":"Persian"}')
check "summary returns success" '"success": true' "$SUM"
check "summary returns summary text" '"summary"' "$SUM"

echo
echo "== Vector store (search mode) =="
check "vector-stats returns stats" '"stats"' "$(curl -s "$BASE/api/vector-stats")"

echo
echo "== Knowledge search (search mode) =="
KS=$(curl -s -X POST "$BASE/api/knowledge-search" -H 'Content-Type: application/json' \
  -d '{"query":"distributed systems","target_language":"Persian","source_language":"English","limit":3}')
check "knowledge-search returns success" '"success": true' "$KS"
check "knowledge-search returns results" '"results"' "$KS"
# An empty result set means the similarity threshold is too strict for real queries.
check "knowledge-search returns a NON-EMPTY result set" '"translated_text"' "$KS"

# An off-topic query must not match this corpus.
OFF=$(curl -s -X POST "$BASE/api/knowledge-search" -H 'Content-Type: application/json' \
  -d '{"query":"how to bake sourdough bread at home","target_language":"English","source_language":"English","limit":3}')
check "off-topic query returns no results" '"results":[]' "$OFF"

echo
echo "== Q&A (search mode) =="
QA=$(curl -s -X POST "$BASE/api/qa" -H 'Content-Type: application/json' \
  -d '{"query":"What is the guiding philosophy?","target_language":"English","source_language":"English","limit":3}')
check "qa returns success" '"success": true' "$QA"
check "qa returns an answer" '"answer"' "$QA"

echo
echo "== History (history mode) =="
check "history returns success" '"success": true' "$(curl -s "$BASE/api/history?limit=5")"
check "history stats returns success" '"success": true' "$(curl -s "$BASE/api/history/stats")"

echo
echo "== File library (sources drawer) =="
check "files returns success" '"success": true' "$(curl -s "$BASE/api/files")"

echo
echo "== Health =="
check "health ok" '"status": "ok"' "$(curl -s "$BASE/api/health")"

echo
echo "-------------------------------------------"
printf 'passed: %d   failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "LIVE TEST PASSED"
  exit 0
fi
echo "LIVE TEST FAILED"
exit 1
