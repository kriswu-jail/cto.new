#!/usr/bin/env bash
set -euo pipefail
: "${WORKER_PORT:=8080}"
: "${WORKER_HOST:=0.0.0.0}"
exec uvicorn worker.app.main:app --host "$WORKER_HOST" --port "$WORKER_PORT"
