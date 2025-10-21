from __future__ import annotations
from typing import List

from ..models import Table


def local_extract_tables(file_bytes: bytes, file_type: str = "image") -> List[Table]:
    """
    Try to extract tables locally using optional libraries.

    Strategy:
    - If images: try PaddleOCR PP-Structure if available
    - If pdf: try Camelot, then Tabula if available

    Returns a list of Table instances. If none of the optional libs are available,
    return a placeholder 1x1 table indicating fallback was used.
    """
    # Try PaddleOCR PP-Structure
    if file_type != "pdf":
        try:
            from paddleocr import PPStructure  # type: ignore
            import cv2  # type: ignore
            import numpy as np  # type: ignore
            import io

            img = cv2.imdecode(np.frombuffer(file_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise RuntimeError("Failed to decode image bytes")
            pp = PPStructure(layout=False, table=True)
            res = pp(img)
            # Simplified: create a single table from text blocks
            # Real implementation should parse res for table cells with spans
            grid = [["" for _ in range(3)] for _ in range(3)]
            for i in range(min(3, len(res))):
                grid[i][0] = str(res[i].get("text", ""))
            return [Table(rows=3, cols=3, grid=grid, merges=[])]
        except Exception:
            pass  # fall through

    # PDFs: Camelot then Tabula
    if file_type == "pdf":
        # Camelot
        try:
            import camelot  # type: ignore
            import io
            # camelot requires a file path; write to temp file
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
                tmp.write(file_bytes)
                tmp.flush()
                tables = camelot.read_pdf(tmp.name, pages="all")
            out: List[Table] = []
            for t in tables:
                grid = [list(map(str, row)) for row in t.df.values.tolist()]
                out.append(Table(rows=len(grid), cols=len(grid[0]) if grid else 0, grid=grid))
            if out:
                return out
        except Exception:
            pass
        # Tabula
        try:
            import tabula  # type: ignore
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
                tmp.write(file_bytes)
                tmp.flush()
                dfs = tabula.read_pdf(tmp.name, pages="all", multiple_tables=True)
            out: List[Table] = []
            for df in dfs or []:
                grid = [list(map(str, row)) for row in df.values.tolist()]
                out.append(Table(rows=len(grid), cols=len(grid[0]) if grid else 0, grid=grid))
            if out:
                return out
        except Exception:
            pass

    # Fallback placeholder
    return [Table(rows=1, cols=1, grid=[["(local fallback placeholder)"]])]
