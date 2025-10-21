from typing import List

import ocr_table.pipeline as pipeline
from ocr_table.models import Table
import ocr_table.providers.aliyun as aliyun_mod


class DummyRecognizer:
    def __init__(self, tables: List[Table], should_raise: bool = False):
        self.tables = tables
        self.should_raise = should_raise

    def recognize(self, file_bytes: bytes, file_type: str = "image") -> List[Table]:
        if self.should_raise:
            raise RuntimeError("API quota exceeded")
        return self.tables


def test_pipeline_provider_success(monkeypatch):
    # Patch provider factory to return dummy recognizer
    dummy_tables = [Table(rows=1, cols=2, grid=[["X", "Y"]])]

    def fake_provider_from_config(provider):
        return DummyRecognizer(dummy_tables)

    monkeypatch.setattr(pipeline, "_provider_from_config", fake_provider_from_config, raising=True)

    out_tables = pipeline.extract_tables(b"\x89PNG....", provider={"name": "aliyun", "endpoint": "http://example"})
    assert len(out_tables) == 1
    assert out_tables[0].grid[0] == ["X", "Y"]


def test_pipeline_provider_failure_fallback(monkeypatch):
    # Make provider raise error and ensure fallback is used
    def fake_recognize(self, file_bytes: bytes, file_type: str = "image"):
        raise RuntimeError("API error")

    # Use the real provider factory but patch recognizer method
    monkeypatch.setattr(aliyun_mod.AliyunTableOCR, "recognize", fake_recognize, raising=True)

    fallback_table = Table(rows=2, cols=2, grid=[["a", "b"], ["c", "d"]])

    def fake_local_extract_tables(file_bytes: bytes, file_type: str = "image"):
        return [fallback_table]

    monkeypatch.setattr(pipeline, "local_extract_tables", fake_local_extract_tables, raising=True)

    tables = pipeline.extract_tables(b"\x89PNG....", provider={"name": "aliyun", "endpoint": "http://example"})
    assert len(tables) == 1
    assert tables[0].grid[1] == ["c", "d"]
