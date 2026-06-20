#!/usr/bin/env bash
#
# Production launcher for the TradeBuzz API service.
#
# The Python bot engine is not a deployable artifact on its own, so the Node API
# server is responsible for starting it in production. This script:
#   1. Starts the Python bot engine (FastAPI) on port 8001 under /engine, and
#      keeps it alive (restarting it if it ever exits).
#   2. Starts the Node API server in the foreground. Node serves /api and proxies
#      authenticated requests to the bot engine at localhost:8001.
#
# Run from the workspace root (the deployment run command's working directory).
set -uo pipefail

run_bot() {
  while true; do
    (
      cd artifacts/tradebuzz-bot-engine || exit 1
      PORT=8001 BASE_PATH=/engine python3 run.py
    )
    echo "[start-prod] bot engine exited; restarting in 3s" >&2
    sleep 3
  done
}

run_bot &

exec node --enable-source-maps artifacts/api-server/dist/index.mjs
