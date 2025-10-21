from ocr_table.providers.aliyun import parse_aliyun_response


def test_parse_aliyun_response_basic():
    payload = {
        "tables": [
            {
                "rows": 2,
                "cols": 3,
                "cells": [
                    {"row": 0, "col": 0, "text": "A1"},
                    {"row": 0, "col": 1, "text": "A2", "colspan": 2},
                    {"row": 1, "col": 0, "text": "B1"},
                    {"row": 1, "col": 1, "text": "B2"},
                    {"row": 1, "col": 2, "text": "B3"},
                ],
            }
        ]
    }

    tables = parse_aliyun_response(payload)
    assert len(tables) == 1
    t = tables[0]
    assert t.rows == 2
    assert t.cols == 3
    assert t.grid[0][0] == "A1"
    assert t.grid[0][1] == "A2"
    assert len(t.merges) == 1
    m = t.merges[0]
    assert (m.first_row, m.first_col, m.last_row, m.last_col) == (0, 1, 0, 2)
