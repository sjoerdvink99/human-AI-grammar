#!/bin/bash
# Set up the virtualenv (first run) and start System X on http://localhost:8765
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
exec .venv/bin/uvicorn backend.app:app --port "${PORT:-8765}"
