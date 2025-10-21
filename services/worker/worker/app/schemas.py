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


TaskType = Literal[
    "office_to_pdf",
    "pdf_to_images",
    "ocr",
    "extract_tables",
    "excel_to_csv",
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
    ]


class JobResult(BaseModel):
    id: Optional[str] = None
    type: TaskType
    status: Literal["ok", "error"] = "ok"
    message: Optional[str] = None
    artifacts: List[Artifact] = Field(default_factory=list)

