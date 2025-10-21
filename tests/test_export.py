import pytest

from ocr_table.models import Table
from ocr_table.export import export_tables_to_xlsx, tables_to_dataframes


@pytest.mark.skipif(__import__('importlib').util.find_spec('pandas') is None, reason='pandas not installed')
def test_tables_to_dataframes_and_export_xlsx(tmp_path):
    import pandas as pd  # type: ignore

    t = Table(rows=2, cols=3, grid=[["A1", "A2", "A3"], ["B1", "B2", "B3"]])
    dfs = tables_to_dataframes([t])
    assert isinstance(dfs[0], pd.DataFrame)
    assert dfs[0].shape == (2, 3)

    out_file = tmp_path / "out.xlsx"
    export_tables_to_xlsx([t], str(out_file))
    assert out_file.exists()
    assert out_file.stat().st_size > 0
