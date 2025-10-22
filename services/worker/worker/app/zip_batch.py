from __future__ import annotations

import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from itertools import count
from pathlib import Path, PurePosixPath
from typing import Dict, List
from urllib.parse import unquote, urlparse

import requests

from .config import settings
from .schemas import ZipBatchCleanPayload


@dataclass
class ZipProcessingResult:
    output_path: Path
    metadata: Dict[str, object]
    logs: List[str]


class ZipProcessingError(Exception):
    def __init__(self, message: str, logs: List[str] | None = None) -> None:
        super().__init__(message)
        self.logs = logs or []


def process_zip_batch_clean(job_id: str | None, payload: ZipBatchCleanPayload) -> ZipProcessingResult:
    logs: List[str] = []
    allowed_extensions = {ext.lower().lstrip(".") for ext in payload.allowed_extensions}
    max_total_size_bytes = int(payload.max_total_size_mb * 1024 * 1024)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        source_archive = _resolve_source_archive(payload.source_url, tmp_path, logs)

        work_dir = tmp_path / "extracted"
        work_dir.mkdir(parents=True, exist_ok=True)

        filtered_entries: List[str] = []
        total_allowed_size = 0

        try:
            with zipfile.ZipFile(source_archive) as archive:
                for info in archive.infolist():
                    member_name = info.filename.replace("\\", "/")
                    relative_path = PurePosixPath(member_name)

                    if not relative_path.parts:
                        continue

                    if _is_unsafe_member(relative_path):
                        logs.append(f"Unsafe archive entry detected: {member_name}")
                        raise ZipProcessingError("Archive contains unsafe paths", logs)

                    target_path = work_dir / Path(*relative_path.parts)

                    if info.is_dir():
                        target_path.mkdir(parents=True, exist_ok=True)
                        continue

                    extension = relative_path.suffix.lower().lstrip(".")
                    if allowed_extensions and extension not in allowed_extensions:
                        filtered_entries.append(str(relative_path))
                        logs.append(
                            f"Filtered {relative_path}: extension '{extension or ''}' not permitted"
                        )
                        continue

                    file_size = max(info.file_size, 0)
                    total_allowed_size += file_size
                    if max_total_size_bytes and total_allowed_size > max_total_size_bytes:
                        logs.append(
                            "Size limit exceeded after including "
                            f"{relative_path} ({file_size} bytes); total {total_allowed_size} bytes > {max_total_size_bytes}"
                        )
                        raise ZipProcessingError("Archive content exceeds size limit", logs)

                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info) as src, open(target_path, "wb") as dst:
                        shutil.copyfileobj(src, dst)
        except zipfile.BadZipFile as exc:
            logs.append(f"Invalid ZIP archive: {exc}")
            raise ZipProcessingError("Failed to read ZIP archive", logs) from exc

        rename_logs = _sanitize_tree(work_dir, payload.replacements or {})

        processed_files = [
            str(path.relative_to(work_dir).as_posix())
            for path in sorted(work_dir.rglob("*"))
            if path.is_file()
        ]
        total_size_bytes = sum(path.stat().st_size for path in work_dir.rglob("*") if path.is_file())

        storage_dir = settings.storage_dir
        storage_dir.mkdir(parents=True, exist_ok=True)
        output_path = _build_output_path(storage_dir, job_id)
        _write_zip_archive(output_path, work_dir)

        combined_logs = logs + rename_logs
        metadata: Dict[str, object] = {
            "processed_files": processed_files,
            "filtered": filtered_entries,
            "renamed": rename_logs,
            "total_size_bytes": total_size_bytes,
            "logs": combined_logs,
        }

        return ZipProcessingResult(output_path=output_path, metadata=metadata, logs=combined_logs)


def _resolve_source_archive(source: str, tmp_dir: Path, logs: List[str]) -> Path:
    parsed = urlparse(source)

    if parsed.scheme in ("http", "https"):
        try:
            response = requests.get(source, timeout=30)
            response.raise_for_status()
        except requests.RequestException as exc:  # pragma: no cover - network errors
            logs.append(f"Failed to download {source}: {exc}")
            raise ZipProcessingError("Failed to download source archive", logs) from exc

        destination = tmp_dir / "downloaded.zip"
        destination.write_bytes(response.content)
        return destination

    if parsed.scheme == "file":
        path = Path(unquote(parsed.path))
        if parsed.netloc and not path.is_absolute():
            path = Path(f"//{parsed.netloc}") / path
        if not path.exists():
            logs.append(f"Source archive not found: {source}")
            raise ZipProcessingError("Source archive not found", logs)
        return path

    if parsed.scheme == "":
        path = Path(source)
        if not path.exists():
            logs.append(f"Source archive not found: {source}")
            raise ZipProcessingError("Source archive not found", logs)
        return path

    logs.append(f"Unsupported source URL scheme: {parsed.scheme}")
    raise ZipProcessingError("Unsupported source URL scheme", logs)


def _write_zip_archive(output_path: Path, root_dir: Path) -> None:
    if output_path.exists():
        output_path.unlink()

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root_dir.rglob("*")):
            if path.is_file():
                archive.write(path, arcname=path.relative_to(root_dir).as_posix())


def _build_output_path(storage_dir: Path, job_id: str | None) -> Path:
    base_name = _slugify(job_id or "job")
    candidate = storage_dir / f"{base_name}-processed.zip"

    for counter in count(1):
        if not candidate.exists():
            return candidate
        candidate = storage_dir / f"{base_name}-processed-{counter}.zip"


def _slugify(value: str) -> str:
    cleaned = "".join(
        ch if ch.isalnum() or ch in {"-", "_"} else "-"
        for ch in value.strip()
    )
    cleaned = cleaned.strip("-")
    return cleaned or "job"


def _is_unsafe_member(path: PurePosixPath) -> bool:
    if path.is_absolute():
        return True
    return any(part in {"", ".", ".."} for part in path.parts)


def _sanitize_tree(root: Path, replacements: Dict[str, str]) -> List[str]:
    rename_logs: List[str] = []

    def sanitize_directory(current: Path) -> None:
        for child in sorted(current.iterdir(), key=lambda item: item.name):
            desired_name = _clean_component(child.name, replacements)
            if not desired_name:
                desired_name = "unnamed"

            unique_name = _ensure_unique_name(current, child, desired_name)
            target = current / unique_name

            if target != child:
                old_relative = child.relative_to(root).as_posix()
                child.rename(target)
                rename_logs.append(
                    f"renamed {old_relative} -> {target.relative_to(root).as_posix()}"
                )
                child = target

            if child.is_dir():
                sanitize_directory(child)

    sanitize_directory(root)
    return rename_logs


def _clean_component(name: str, replacements: Dict[str, str]) -> str:
    cleaned = "".join(name.split())
    for source, target in replacements.items():
        cleaned = cleaned.replace(source, target)
    cleaned = cleaned.replace("/", "_").replace("\\", "_")
    return cleaned


def _ensure_unique_name(parent: Path, current: Path, desired: str) -> str:
    candidate = desired
    index = 1
    while True:
        target = parent / candidate
        if target == current or not target.exists():
            return candidate
        candidate = _append_suffix(desired, index)
        index += 1


def _append_suffix(name: str, suffix_index: int) -> str:
    pure = PurePosixPath(name)
    suffix = "".join(pure.suffixes)
    if suffix:
        stem = name[: -len(suffix)]
    else:
        stem = name

    if not stem:
        stem = "unnamed"

    return f"{stem}_{suffix_index}{suffix}"
