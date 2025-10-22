import hashlib
import hmac
import json
import time
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

from worker.app.config import settings
from worker.app.main import app


def _sign(body: dict) -> tuple[str, str, bytes]:
    timestamp = str(int(time.time()))
    raw = json.dumps(body).encode()
    signature = hmac.new(
        settings.worker_shared_secret.encode(),
        f"{timestamp}.".encode() + raw,
        hashlib.sha256,
    ).hexdigest()
    return timestamp, signature, raw


def _create_zip_from_directory(root: Path, destination: Path) -> Path:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, arcname=path.relative_to(root).as_posix())
    return destination


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_zip_batch_clean_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    storage_dir = tmp_path / "artifacts"
    monkeypatch.setattr(settings, "storage_dir", storage_dir)

    src_root = tmp_path / "input"
    nested_dir = src_root / "一级 目录" / "多 层 @目录"
    nested_dir.mkdir(parents=True)

    (nested_dir / "文件 #1.txt").write_text("你好", encoding="utf-8")
    (nested_dir / "木马.exe").write_text("恶意", encoding="utf-8")
    (src_root / "中文 文件.csv").write_text("col1,col2", encoding="utf-8")

    source_archive = _create_zip_from_directory(src_root, tmp_path / "source.zip")

    body = {
        "id": "zip-job-测试",
        "type": "zip_batch_clean",
        "payload": {
            "source_url": source_archive.as_uri(),
            "allowed_extensions": ["txt", "csv"],
            "replacements": {"#": "_", "@": ""},
            "max_total_size_mb": 2,
        },
    }

    timestamp, signature, _ = _sign(body)
    response = client.post(
        "/jobs",
        headers={"x-timestamp": timestamp, "x-signature": signature},
        json=body,
    )

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "ok"
    assert result["type"] == "zip_batch_clean"
    assert result["artifacts"], "expected artifact for processed archive"

    artifact = result["artifacts"][0]
    assert artifact["kind"] == "zip"

    metadata = artifact["metadata"]
    processed_files = sorted(metadata["processed_files"])
    assert processed_files == [
        "中文文件.csv",
        "一级目录/多层目录/文件_1.txt",
    ]

    assert "一级 目录/多 层 @目录/木马.exe" in metadata["filtered"]

    rename_log = "renamed 一级目录/多层目录/文件 #1.txt -> 一级目录/多层目录/文件_1.txt"
    assert any(rename_log in entry for entry in metadata["renamed"])

    artifact_path = Path(urlparse(artifact["url"]).path)
    assert artifact_path.exists()

    with zipfile.ZipFile(artifact_path) as archive:
        names = sorted(archive.namelist())
        assert names == [
            "中文文件.csv",
            "一级目录/多层目录/文件_1.txt",
        ]
        extracted = archive.read("一级目录/多层目录/文件_1.txt").decode("utf-8")
        assert extracted == "你好"

    expected_total_size = len("你好".encode("utf-8")) + len("col1,col2".encode("utf-8"))
    assert metadata["total_size_bytes"] == expected_total_size


def test_zip_batch_clean_size_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    storage_dir = tmp_path / "artifacts"
    monkeypatch.setattr(settings, "storage_dir", storage_dir)

    src_root = tmp_path / "overflow"
    src_root.mkdir(parents=True)
    large_file = src_root / "巨大的文件.txt"
    large_file.write_bytes(b"A" * (1024 * 1024))

    source_archive = _create_zip_from_directory(src_root, tmp_path / "large.zip")

    body = {
        "id": "zip-job-limit",
        "type": "zip_batch_clean",
        "payload": {
            "source_url": source_archive.as_uri(),
            "allowed_extensions": ["txt"],
            "max_total_size_mb": 0.5,
        },
    }

    timestamp, signature, _ = _sign(body)
    response = client.post(
        "/jobs",
        headers={"x-timestamp": timestamp, "x-signature": signature},
        json=body,
    )

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "error"
    assert "size limit" in result["message"].lower()
    assert result["artifacts"] == []
    assert not storage_dir.exists()
