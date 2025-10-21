from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import json

from ..models import Cell, Table

try:
    import requests  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    requests = None  # type: ignore


@dataclass
class AliyunTableOCR:
    endpoint: str
    api_key: Optional[str] = None
    access_key_id: Optional[str] = None
    access_key_secret: Optional[str] = None

    def recognize(self, file_bytes: bytes, file_type: str = "image") -> List[Table]:
        if requests is None:
            raise RuntimeError("requests is required for Aliyun provider")
        headers: Dict[str, str] = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        # NOTE: Real Aliyun authentication/signing is not implemented here. In production,
        # sign the request according to the provider's API.
        files = {"file": (f"input.{ 'pdf' if file_type == 'pdf' else 'png' }", file_bytes)}
        resp = requests.post(self.endpoint, headers=headers, files=files, timeout=60)
        if resp.status_code != 200:
            raise RuntimeError(f"Aliyun OCR failed: HTTP {resp.status_code}")
        try:
            data = resp.json()
        except json.JSONDecodeError:
            # Some providers return stringified JSON
            data = json.loads(resp.text)
        return parse_aliyun_response(data)


def parse_aliyun_response(payload: Dict[str, Any]) -> List[Table]:
    """
    Parse a generic provider payload into a list of Table.

    Expected structure (simplified example):
    {
      "tables": [
        {
          "rows": 3, "cols": 3,
          "cells": [
             {"row":0, "col":0, "text":"A1", "rowspan":1, "colspan":1},
             {"row":0, "col":1, "text":"A2", "rowspan":1, "colspan":2},
             ...
          ]
        }
      ]
    }

    Real providers vary; adapt this parser to the actual JSON response.
    """
    tables: List[Table] = []
    tbls = payload.get("tables") or payload.get("data") or []
    for t in tbls:
        cells_json = t.get("cells") or []
        cells: List[Cell] = []
        for cj in cells_json:
            cells.append(
                Cell(
                    row=int(cj.get("row") or cj.get("rowIndex") or 0),
                    col=int(cj.get("col") or cj.get("colIndex") or 0),
                    text=str(cj.get("text") or cj.get("value") or ""),
                    rowspan=int(cj.get("rowspan") or cj.get("rowSpan") or 1),
                    colspan=int(cj.get("colspan") or cj.get("colSpan") or 1),
                )
            )
        rows = int(t.get("rows") or t.get("rowCount") or 0)
        cols = int(t.get("cols") or t.get("colCount") or 0)
        table = Table.from_cells(cells, rows=rows or None, cols=cols or None)
        tables.append(table)
    return tables
