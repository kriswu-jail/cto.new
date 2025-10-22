from __future__ import annotations

import tempfile
from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    app_name: str = Field(default="worker")
    environment: str = Field(default="development")
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8080)

    # Shared secret for HMAC signing between Node API and worker
    worker_shared_secret: str = Field(default="change-me")

    # Maximum allowed clock skew for signed requests (seconds)
    auth_tolerance_seconds: int = Field(default=300)

    # Local directory used to persist generated artifacts before they are served
    storage_dir: Path = Field(
        default_factory=lambda: Path(tempfile.gettempdir()) / "worker-storage"
    )

    class Config:
        env_prefix = "WORKER_"
        env_file = ".env"
        extra = "allow"


settings = Settings()