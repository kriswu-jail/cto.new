import io
import os
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from xlsx_png.exporter import export_xlsx_to_pngs

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="XLSX to PNG Exporter")

app.mount("/assets", StaticFiles(directory=str(STORAGE_DIR)), name="assets")


@app.get("/")
def index() -> HTMLResponse:
    html = (
        """
        <html>
          <head><title>XLSX → PNG Export</title></head>
          <body>
            <h1>XLSX → PNG Export</h1>
            <form action="/export/png" method="post" enctype="multipart/form-data">
              <label>Excel file (.xlsx): <input name="file" type="file" required /></label><br/>
              <label>DPI: <input name="dpi" type="number" value="150" /></label><br/>
              <button type="submit">Export PNG</button>
            </form>
          </body>
        </html>
        """
    )
    return HTMLResponse(content=html)


@app.post("/export/png")
async def export_png(
    file: UploadFile = File(...),
    dpi: Optional[int] = Form(150),
):
    job_id = uuid.uuid4().hex
    job_dir = STORAGE_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # Save upload to a temp path inside job dir
    upload_path = job_dir / file.filename
    content = await file.read()
    with open(upload_path, "wb") as f:
        f.write(content)

    # Export to PNGs
    png_paths, zip_path = export_xlsx_to_pngs(
        input_xlsx=str(upload_path),
        output_dir=str(job_dir),
        dpi=dpi or 150,
        return_zip=True,
    )

    # Build asset URLs
    base_url = f"/assets/{job_id}"
    assets = [f"{base_url}/{Path(p).name}" for p in png_paths]
    zip_url = f"{base_url}/{Path(zip_path).name}" if zip_path else None

    return JSONResponse(
        {
            "jobId": job_id,
            "images": assets,
            "zip": zip_url,
            "count": len(png_paths),
        }
    )


@app.get("/download/{job_id}/{filename}")
async def download(job_id: str, filename: str):
    file_path = STORAGE_DIR / job_id / filename
    if not file_path.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)
    return FileResponse(path=str(file_path))
