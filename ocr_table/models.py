from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional, Tuple


@dataclass
class MergeRange:
    first_row: int
    first_col: int
    last_row: int
    last_col: int

    def as_tuple(self) -> Tuple[int, int, int, int]:
        return (self.first_row, self.first_col, self.last_row, self.last_col)


@dataclass
class Cell:
    row: int
    col: int
    text: str = ""
    rowspan: int = 1
    colspan: int = 1


@dataclass
class Table:
    rows: int
    cols: int
    # grid contains text, indexed by [row][col]
    grid: List[List[str]] = field(default_factory=list)
    merges: List[MergeRange] = field(default_factory=list)

    def ensure_grid(self) -> None:
        if not self.grid or len(self.grid) != self.rows or any(len(r) != self.cols for r in self.grid):
            self.grid = [["" for _ in range(self.cols)] for _ in range(self.rows)]

    @classmethod
    def from_cells(cls, cells: List[Cell], rows: Optional[int] = None, cols: Optional[int] = None) -> "Table":
        max_row = max((c.row + c.rowspan - 1) for c in cells) if cells else -1
        max_col = max((c.col + c.colspan - 1) for c in cells) if cells else -1
        r = rows if rows is not None else (max_row + 1)
        c = cols if cols is not None else (max_col + 1)
        table = cls(rows=r, cols=c)
        table.ensure_grid()
        for cell in cells:
            table.grid[cell.row][cell.col] = cell.text
            if cell.rowspan > 1 or cell.colspan > 1:
                mr = MergeRange(
                    first_row=cell.row,
                    first_col=cell.col,
                    last_row=cell.row + cell.rowspan - 1,
                    last_col=cell.col + cell.colspan - 1,
                )
                table.merges.append(mr)
        return table

    def to_dataframe(self):
        try:
            import pandas as pd  # type: ignore
        except Exception as exc:
            raise ImportError("pandas is required to convert Table to DataFrame") from exc
        self.ensure_grid()
        return pd.DataFrame(self.grid)
