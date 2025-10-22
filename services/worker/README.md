Worker Service

Python worker service with FastAPI entrypoint, signed request verification, and stub handlers for job types.

Features
- FastAPI + Uvicorn server
- Pydantic schemas for job payloads
- HMAC-signed request verification (shared secret)
- Stub handlers returning dummy artifacts for:
  - office_to_pdf
  - pdf_to_images
  - ocr
  - extract_tables
  - excel_to_csv
- Dockerfile with system deps: LibreOffice headless, Poppler, Java, Ghostscript, OCR deps, Camelot/Tabula, Chinese fonts
- Makefile and Invoke tasks for local dev
- Python tests and a Node integration script for handshake and job submission

Quick start (local)
1. Set env:
   export WORKER_WORKER_SHARED_SECRET=dev-secret
   export WORKER_PORT=8080

2. Install deps (Poetry recommended):
   - Install Poetry: https://python-poetry.org/docs/#installation
   - poetry install

3. Run server:
   poetry run uvicorn worker.app.main:app --host 0.0.0.0 --port ${WORKER_PORT:-8080}

4. Call API (signed request):
   TIMESTAMP=$(date +%s)
   BODY='{"type":"office_to_pdf","payload":{"source_url":"https://example.com/file.docx"}}'
   SIG=$(python - <<PY
import hmac, hashlib, os
secret = os.environ.get('WORKER_WORKER_SHARED_SECRET','dev-secret')
ts=os.environ['TIMESTAMP']
body=os.environ['BODY'].encode()
print(hmac.new(secret.encode(), f"{ts}.".encode()+body, hashlib.sha256).hexdigest())
PY
)
   curl -s -H "x-timestamp: $TIMESTAMP" -H "x-signature: $SIG" \
     -H 'Content-Type: application/json' \
     -d "$BODY" http://localhost:${WORKER_PORT:-8080}/jobs | jq .

Docker
- Build: make docker-build
- Run:   make docker-run

Node integration test
- Requires Node >= 18
  node tests/integration/node_client.mjs

