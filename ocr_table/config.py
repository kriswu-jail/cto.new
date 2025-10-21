import os
from dataclasses import dataclass
from typing import Optional, Dict, Any


@dataclass
class ProviderConfig:
    name: str
    endpoint: Optional[str] = None
    api_key: Optional[str] = None
    access_key_id: Optional[str] = None
    access_key_secret: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None

    @classmethod
    def from_env(cls) -> "ProviderConfig | None":
        name = os.getenv("OCR_PROVIDER_NAME")
        if not name:
            return None
        return cls(
            name=name,
            endpoint=os.getenv("OCR_PROVIDER_ENDPOINT"),
            api_key=os.getenv("OCR_PROVIDER_API_KEY"),
            access_key_id=os.getenv("OCR_PROVIDER_ACCESS_KEY_ID"),
            access_key_secret=os.getenv("OCR_PROVIDER_ACCESS_KEY_SECRET"),
        )
