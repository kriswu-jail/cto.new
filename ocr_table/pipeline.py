from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple, Union
import os

from .models import Table
from .config import ProviderConfig
from .providers import AliyunTableOCR
from .fallback import local_extract_tables
from .export import export_tables_to_xlsx


def _read_input(input_source: Union[str, bytes]) -> Tuple[bytes, str]:
    if isinstance(input_source, bytes):
        # Best effort type detection
        file_type = "pdf" if input_source[:4] == b"%PDF" else "image"
        return input_source, file_type
    # string path
    with open(input_source, "rb") as f:
        data = f.read()
    ext = os.path.splitext(input_source)[1].lower()
    if ext == ".pdf":
        return data, "pdf"
    return data, "image"


def _provider_from_config(provider: Optional[Dict[str, Any] | ProviderConfig]):
    if provider is None:
        cfg = ProviderConfig.from_env()
        if not cfg:
            return None
    elif isinstance(provider, dict):
        cfg = ProviderConfig(**provider)
    else:
        cfg = provider

    name = (cfg.name or "").lower()
    if name == "aliyun":
        if not cfg.endpoint:
            raise ValueError("Aliyun provider requires endpoint")
        return AliyunTableOCR(
            endpoint=cfg.endpoint,
            api_key=cfg.api_key,
            access_key_id=cfg.access_key_id,
            access_key_secret=cfg.access_key_secret,
        )
    # Add other providers here if needed
    raise ValueError(f"Unsupported provider: {cfg.name}")


def extract_tables(
    input_source: Union[str, bytes],
    provider: Optional[Dict[str, Any] | ProviderConfig] = None,
) -> List[Table]:
    file_bytes, file_type = _read_input(input_source)

    # Try provider if configured
    recognizer = None
    try:
        recognizer = _provider_from_config(provider)
    except Exception:
        recognizer = None

    if recognizer is not None:
        try:
            tables = recognizer.recognize(file_bytes, file_type=file_type)
            if tables:
                return tables
        except Exception:
            # Provider failed, fall back
            pass

    # Fallback
    return local_extract_tables(file_bytes, file_type=file_type)


def extract_tables_to_xlsx(
    input_source: Union[str, bytes],
    output_xlsx: str,
    provider: Optional[Dict[str, Any] | ProviderConfig] = None,
) -> None:
    tables = extract_tables(input_source, provider=provider)
    export_tables_to_xlsx(tables, output_xlsx)


__all__ = [
    "extract_tables",
    "extract_tables_to_xlsx",
]