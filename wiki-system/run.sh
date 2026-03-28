#!/usr/bin/env bash
# ============================================================
# Employee Wiki Assistant — Local Development Runner
#
# Starts the wiki app directly with Python (no Docker required).
# Requires: OPENRAG_BASE_URL and OPENRAG_API_KEY in environment
#           or a .env file in this directory.
#
# Usage:
#   ./run.sh                    # start on default port 8000
#   ./run.sh --port 9000        # start on custom port
#   ./run.sh --reload           # enable auto-reload (dev mode)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8000
RELOAD=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)  PORT="$2"; shift 2 ;;
    --reload) RELOAD="--reload"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Load .env if present
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  echo "Loading .env…"
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

# Validate required env vars
if [[ -z "${OPENRAG_BASE_URL:-}" ]]; then
  echo "ERROR: OPENRAG_BASE_URL is not set."
  echo "       Set it in .env or export it before running this script."
  echo "       Example: export OPENRAG_BASE_URL=http://localhost:8080/api/v1"
  exit 1
fi
if [[ -z "${OPENRAG_API_KEY:-}" ]]; then
  echo "ERROR: OPENRAG_API_KEY is not set."
  echo "       Set it in .env or export it before running this script."
  exit 1
fi

# Install Python deps if needed
if ! python3 -c "import fastapi, uvicorn, httpx" 2>/dev/null; then
  echo "Installing Python dependencies…"
  pip3 install -q -r "$SCRIPT_DIR/requirements.txt"
fi

echo ""
echo "  📚 Employee Wiki Assistant"
echo "  ───────────────────────────"
echo "  URL:      http://localhost:$PORT"
echo "  OpenRAG:  $OPENRAG_BASE_URL"
echo "  API docs: http://localhost:$PORT/docs"
echo ""

cd "$SCRIPT_DIR/backend"
exec python3 -m uvicorn main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  $RELOAD
