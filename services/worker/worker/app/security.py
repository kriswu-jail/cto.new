from __future__ import annotations

import hmac
import time
from hashlib import sha256
from typing import Optional

from fastapi import Header, HTTPException, Request

from .config import settings


SIGNATURE_HEADER = "x-signature"
TIMESTAMP_HEADER = "x-timestamp"


def compute_signature(secret: str, timestamp: str, body: bytes) -> str:
    # The signature is HMAC-SHA256 over the string f"{timestamp}.{body}"
    msg = timestamp.encode("utf-8") + b"." + body
    digest = hmac.new(secret.encode("utf-8"), msg, sha256).hexdigest()
    return digest


async def verify_request_signature(
    request: Request,
    x_signature: Optional[str] = Header(default=None, alias=SIGNATURE_HEADER),
    x_timestamp: Optional[str] = Header(default=None, alias=TIMESTAMP_HEADER),
) -> None:
    if not x_signature or not x_timestamp:
        raise HTTPException(status_code=401, detail="Missing signature headers")

    try:
        ts_val = int(x_timestamp)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid timestamp header")

    now = int(time.time())
    # Reject requests too old or too far in the future
    tolerance = int(settings.auth_tolerance_seconds)
    if abs(now - ts_val) > tolerance:
        raise HTTPException(status_code=401, detail="Timestamp out of tolerance")

    # Read body bytes for signature verification
    body = await request.body()

    expected = compute_signature(settings.worker_shared_secret, x_timestamp, body)
    # Use constant-time comparison
    if not hmac.compare_digest(expected, x_signature):
        raise HTTPException(status_code=401, detail="Invalid signature")


async def sign_server_message(payload: bytes) -> dict[str, str]:
    ts = str(int(time.time()))
    sig = compute_signature(settings.worker_shared_secret, ts, payload)
    return {"timestamp": ts, "signature": sig}
