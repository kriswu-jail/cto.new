# OCR Table Extraction: Image/PDF → Excel with Third-Party + PaddleOCR Fallback

This package provides a pluggable OCR pipeline to extract tables from images or PDFs and export them to Excel (XLSX). It tries a third-party provider first (e.g., Alibaba Cloud Table Recognition) and gracefully falls back to local extraction using PaddleOCR + PP-Structure and Camelot/Tabula.

Features:
- Configurable third-party OCR provider with credentials via environment variables
- Parses OCR output into a normalized table model and Pandas DataFrame
- Exports to XLSX with merged cells and simple borders where possible
- Fallback to local extraction when API fails or quota is exceeded
- Unit tests use mocking to avoid heavy dependencies and network calls

## Install

This repo is self-contained and tests are written to run without heavy optional dependencies. If you want full functionality locally, install the optional extras:

- pandas
- xlsxwriter (preferred) or openpyxl
- requests
- paddleocr (includes PP-Structure)
- camelot-py[cv] or tabula-py (requires Java)

Example with pip:

```
pip install pandas xlsxwriter requests
# Optional fallback libs:
pip install paddleocr camelot-py[cv] tabula-py
```

## Usage

```
from ocr_table.pipeline import extract_tables_to_xlsx

# From a file path or bytes
extract_tables_to_xlsx(
    input_source="/path/to/input.pdf", # or bytes
    output_xlsx="/path/to/output.xlsx",
    provider={
        "name": "aliyun",
        "endpoint": "https://example.aliyunapi.com/table/recognize",
        "api_key": "...",  # or access_key_id/access_key_secret depending on provider
    },
)
```

You can also use the lower-level functions to obtain Pandas DataFrames:

```
from ocr_table.pipeline import extract_tables

dfs = extract_tables("/path/to/image.png")
for i, df in enumerate(dfs):
    print(f"Table {i}:")
    print(df)
```

## Configuration

Environment variables (optional):
- OCR_PROVIDER_NAME (e.g., "aliyun")
- OCR_PROVIDER_ENDPOINT
- OCR_PROVIDER_API_KEY or OCR_PROVIDER_ACCESS_KEY_ID and OCR_PROVIDER_ACCESS_KEY_SECRET

## Quality recommendations for best results

To maximize table detection and recognition quality:
- Use high-resolution images (≥ 300 DPI) or vector PDFs when possible
- Ensure strong contrast between text and background
- Keep tables upright; deskew scanned images if needed
- Avoid heavy compression artifacts; use PNG/TIFF for images if possible
- Include visible grid lines or clear cell boundaries when feasible
- Crop to the table region for best accuracy, especially for multi-table pages

## Notes on fallback

The fallback tries, in order:
1) PaddleOCR PP-Structure for image layout analysis and table structure
2) Camelot (or Tabula) for PDFs when PP-Structure is unavailable

If these libraries are not installed, the fallback returns a minimal placeholder table to keep the pipeline robust. In production, install and enable these dependencies for best results.

## Testing

Tests are written with pytest and avoid external API calls by mocking providers and fallbacks. Some tests require optional dependencies and will be skipped automatically if those packages are not installed (e.g., pandas/xlsxwriter).

Run tests:

```
pytest -q
```
