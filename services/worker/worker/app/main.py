from __future__ import annotations

import json
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from .config import settings
from .schemas import JobRequest, JobResult
from .handlers import process_job
from .security import verify_request_signature, sign_server_message


app = FastAPI(title="Worker Service", version="0.1.0")


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "name": settings.app_name, "env": settings.environment}


@app.get("/handshake")
async def handshake(request: Request, _auth=Depends(verify_request_signature)):
    payload = json.dumps({"hello": "node"}).encode("utf-8")
    headers = await sign_server_message(payload)
    return JSONResponse(content={"message": "ok", **headers})


@app.post("/jobs", response_model=JobResult)
async def enqueue_job(job: JobRequest, _auth=Depends(verify_request_signature)):
    result = process_job(job)
    return result


# Entrypoint for running with `python -m worker.app.main`
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "worker.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )
