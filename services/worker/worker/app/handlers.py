from __future__ import annotations

from typing import List

from .schemas import (
    Artifact,
    ExtractTablesPayload,
    ExcelToCsvPayload,
    JobRequest,
    JobResult,
    OCRPayload,
    OfficeToPdfPayload,
    PdfToImagesPayload,
)


def _dummy_url(job_id: str | None, suffix: str) -> str:
    base = job_id or "dummy-job"
    return f"https://example.com/artifacts/{base}/{suffix}"


def handle_office_to_pdf(job: JobRequest, payload: OfficeToPdfPayload) -> List[Artifact]:
    return [
        Artifact(
            kind="pdf",
            url=_dummy_url(job.id, "output.pdf"),
            metadata={"source": str(payload.source_url)},
        )
    ]


def handle_pdf_to_images(job: JobRequest, payload: PdfToImagesPayload) -> List[Artifact]:
    urls = [
        _dummy_url(job.id, f"page-{i+1}.png") for i in range(2)
    ]  # pretend 2 pages
    return [Artifact(kind="image", url=u, metadata={"dpi": payload.dpi}) for u in urls]


def handle_ocr(job: JobRequest, payload: OCRPayload) -> List[Artifact]:
    return [
        Artifact(
            kind="text",
            url=_dummy_url(job.id, "recognized.txt"),
            metadata={"lang": payload.lang},
        )
    ]


def handle_extract_tables(job: JobRequest, payload: ExtractTablesPayload) -> List[Artifact]:
    return [
        Artifact(
            kind="csv",
            url=_dummy_url(job.id, "tables.csv"),
            metadata={"flavor": payload.flavor, "pages": payload.pages},
        )
    ]


def handle_excel_to_csv(job: JobRequest, payload: ExcelToCsvPayload) -> List[Artifact]:
    return [
        Artifact(
            kind="csv",
            url=_dummy_url(job.id, "sheet.csv"),
            metadata={"sheet": payload.sheet},
        )
    ]


def process_job(job: JobRequest) -> JobResult:
    if job.type == "office_to_pdf":
        artifacts = handle_office_to_pdf(job, job.payload)  # type: ignore[arg-type]
    elif job.type == "pdf_to_images":
        artifacts = handle_pdf_to_images(job, job.payload)  # type: ignore[arg-type]
    elif job.type == "ocr":
        artifacts = handle_ocr(job, job.payload)  # type: ignore[arg-type]
    elif job.type == "extract_tables":
        artifacts = handle_extract_tables(job, job.payload)  # type: ignore[arg-type]
    elif job.type == "excel_to_csv":
        artifacts = handle_excel_to_csv(job, job.payload)  # type: ignore[arg-type]
    else:
        raise ValueError(f"Unknown job type: {job.type}")

    return JobResult(id=job.id, type=job.type, status="ok", artifacts=artifacts)
