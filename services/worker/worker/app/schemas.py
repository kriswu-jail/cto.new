from __future__ import annotations

from typing import Literal, Optional, Union, List, Dict, Any
from pydantic import BaseModel, HttpUrl, Field


class Artifact(BaseModel):
    kind: str
    url: HttpUrl
    metadata: Dict[str, Any] = Field(default_factory=dict)


class OfficeToPdfPayload(BaseModel):
    source_url: HttpUrl


class PdfToImagesPayload(BaseModel):
    source_url: HttpUrl
    dpi: int = 200


class OCRPayload(BaseModel):
    source_url: HttpUrl
    lang: str = "ch"


class ExtractTablesPayload(BaseModel):
    source_url: HttpUrl
    flavor: Literal["lattice", "stream"] = "lattice"
    pages: str = "1"


class ExcelToCsvPayload(BaseModel):
    source_url: HttpUrl
    sheet: Optional[Union[int, str]] = None


class ZipBatchCleanPayload(BaseModel):
    source_url: str = Field(
        ...,
        description="Supports http(s) URLs or file paths for the source ZIP archive",
    )
    allowed_extensions: List[str] = Field(
        default_factory=list,
        description="List of lowercase file extensions allowed in the output archive",
    )
    replacements: Dict[str, str] = Field(
        default_factory=dict,
        description="Mapping of characters to replace in file and directory names",
    )
    max_total_size_mb: float = Field(
        default=50.0,
        gt=0,
        description="Maximum total size (in megabytes) of allowed files in the archive",
    )


TaskType = Literal[
    "office_to_pdf",
    "pdf_to_images",
    "ocr",
    "extract_tables",
    "excel_to_csv",
    "zip_batch_clean",
]


class JobRequest(BaseModel):
    id: Optional[str] = None
    type: TaskType
    payload: Union[
        OfficeToPdfPayload,
        PdfToImagesPayload,
        OCRPayload,
        ExtractTablesPayload,
        ExcelToCsvPayload,
        ZipBatchCleanPayload,
    ]


class JobResult(BaseModel):
    id: Optional[str] = None
    type: TaskType
    status: Literal["ok", "error"] = "ok"
    message: Optional[str] = None
    artifacts: List[Artifact] = Field(default_factory=list)

