import os
from pathlib import Path

import pytest
from PIL import Image
import openpyxl

from xlsx_png.exporter import export_xlsx_to_pngs, DEFAULT_PAGE_SIZE_INCHES


def create_workbook(path: str, sheets: int = 3):
    wb = openpyxl.Workbook()
    # The default workbook starts with one sheet; adjust accordingly
    default = wb.active
    default.title = "Sheet 1"
    for i in range(2, sheets + 1):
        wb.create_sheet(title=f"Sheet {i}")
    wb.save(path)


@pytest.fixture()
def tmp_dir(tmp_path: Path) -> Path:
    return tmp_path


def test_multi_sheet_export(tmp_dir: Path):
    xlsx = tmp_dir / "book.xlsx"
    create_workbook(str(xlsx), sheets=4)

    images, zip_path = export_xlsx_to_pngs(
        input_xlsx=str(xlsx),
        output_dir=str(tmp_dir),
        dpi=96,
        return_zip=True,
        transparent=True,
    )

    assert len(images) == 4, "Should export one image per sheet/page"
    for idx, img_path in enumerate(images, start=1):
        p = Path(img_path)
        assert p.exists(), f"Image not created: {p}"
        assert p.name.endswith(f"page-{idx:03d}.png"), "Naming convention mismatch"

    assert zip_path is not None, "Should produce a zip when multiple images"
    assert Path(zip_path).exists(), "Zip archive must exist"


def test_dpi_and_transparency(tmp_dir: Path):
    xlsx = tmp_dir / "book2.xlsx"
    create_workbook(str(xlsx), sheets=1)

    dpi = 100
    images, _ = export_xlsx_to_pngs(
        input_xlsx=str(xlsx),
        output_dir=str(tmp_dir),
        dpi=dpi,
        return_zip=False,
        transparent=True,
    )

    assert len(images) == 1
    im = Image.open(images[0])
    # Expect RGBA for transparency
    assert im.mode == "RGBA"
    # Expected size based on default page size in inches * dpi
    expected_w = int(DEFAULT_PAGE_SIZE_INCHES[0] * dpi)
    expected_h = int(DEFAULT_PAGE_SIZE_INCHES[1] * dpi)
    assert im.size == (expected_w, expected_h)
    # Check that the background is fully transparent (alpha 0) at a corner pixel
    alpha = im.getpixel((0, 0))[3]
    assert alpha == 0
