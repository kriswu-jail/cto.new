import hmac
import hashlib
import json
import time
from fastapi.testclient import TestClient

from worker.app.main import app
from worker.app.config import settings


def sign(body: dict | None):
    ts = str(int(time.time()))
    raw = json.dumps(body).encode() if body is not None else b""
    sig = hmac.new(
        settings.worker_shared_secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256
    ).hexdigest()
    return ts, sig, raw


def test_handshake_signature():
    client = TestClient(app)
    ts, sig, _ = sign(None)
    r = client.get("/handshake", headers={"x-timestamp": ts, "x-signature": sig})
    assert r.status_code == 200
    data = r.json()
    assert data["message"] == "ok"
    assert "timestamp" in data and "signature" in data


def test_job_stub():
    client = TestClient(app)
    body = {
        "id": "test-1",
        "type": "office_to_pdf",
        "payload": {"source_url": "https://example.com/a.docx"},
    }
    ts, sig, raw = sign(body)
    r = client.post("/jobs", headers={"x-timestamp": ts, "x-signature": sig}, json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["type"] == "office_to_pdf"
    assert data["artifacts"][0]["url"].endswith("output.pdf")
