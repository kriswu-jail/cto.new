import os
import tempfile

import pandas as pd
import pytest

from excel_batch_cleaner import apply_operations, validate_config, CLEAN_SCHEMA


def make_excel(tmp_path):
    sheet1 = pd.DataFrame(
        {
            "姓名": [" 张三 ", "李四", "张三"],
            "地址": [" 北京-海淀 ", None, "上海(浦东)"],
            "Code": ["AbC123", "xyz789", "AbC123"],
            "日期": ["2023/01/02", "2023-03-04", "2023年05月06日"],
        }
    )
    sheet2 = pd.DataFrame(
        {
            "产品": ["苹果", "香蕉", "苹果"],
            "数量": [1, 2, 1],
            "备注": ["VIP 客户", "普通-客户", "VIP 客户"],
        }
    )
    input_file = os.path.join(tmp_path, "input.xlsx")
    with pd.ExcelWriter(input_file, engine="openpyxl") as writer:
        sheet1.to_excel(writer, sheet_name="Sheet1", index=False)
        sheet2.to_excel(writer, sheet_name="明细", index=False)
    return input_file


def read_sheets(path):
    xls = pd.ExcelFile(path)
    sheets = {}
    for name in xls.sheet_names:
        sheets[name] = pd.read_excel(xls, sheet_name=name, dtype=object)
    return sheets


def test_schema_validation_errors():
    config = {"operations": [{"type": "remove_chars"}]}  # missing characters
    issues = validate_config(config)
    assert issues


def test_trim_and_remove_chars_and_case(tmp_path):
    input_file = make_excel(tmp_path)
    output_file = os.path.join(tmp_path, "output.xlsx")
    config = {
        "input_path": input_file,
        "output_path": output_file,
        "operations": [
            {"type": "trim", "sheets": ["Sheet1"], "columns": {"names": ["姓名", "地址"]}},
            {"type": "remove_chars", "sheets": ["Sheet1"], "columns": {"names": ["地址"]}, "characters": "()-"},
            {"type": "case", "sheets": ["Sheet1"], "columns": {"names": ["Code"]}, "mode": "lower"},
        ],
    }
    res = apply_operations(config)
    assert res["ok"]
    sheets = read_sheets(output_file)
    df = sheets["Sheet1"]
    assert list(df["姓名"]) == ["张三", "李四", "张三"]
    assert list(df["地址"]) == ["北京海淀", None, "上海浦东"]
    assert list(df["Code"]) == ["abc123", "xyz789", "abc123"]


def test_regex_and_date_format_and_deduplicate(tmp_path):
    input_file = make_excel(tmp_path)
    output_file = os.path.join(tmp_path, "output2.xlsx")
    config = {
        "input_path": input_file,
        "output_path": output_file,
        "operations": [
            {"type": "regex_replace", "sheets": ["Sheet1"], "columns": {"names": ["Code"]}, "pattern": "[0-9]+", "replacement": "#"},
            {"type": "date_format", "sheets": ["Sheet1"], "columns": {"names": ["日期"]}, "output_format": "%Y-%m-%d"},
            {"type": "deduplicate", "sheets": ["Sheet1"], "subset": ["姓名", "Code"]},
        ],
    }
    res = apply_operations(config)
    assert res["ok"]
    sheets = read_sheets(output_file)
    df = sheets["Sheet1"]
    assert list(df["Code"]) == ["AbC#", "xyz#"]
    assert list(df["日期"]) == ["2023-01-02", "2023-03-04"]
    assert list(df["姓名"]) == [" 张三 ", "李四"]  # trim not applied in this test


def test_bulk_replace_and_excel_range_and_chinese_sheet(tmp_path):
    input_file = make_excel(tmp_path)
    output_file = os.path.join(tmp_path, "output3.xlsx")
    config = {
        "input_path": input_file,
        "output_path": output_file,
        "operations": [
            {  # replace "VIP" with "重要"
                "type": "bulk_replace",
                "sheets": ["明细"],
                "columns": {"excel_range": "A:B"},
                "mapping": [{"from": "苹果", "to": "Apple"}, {"from": "香蕉", "to": "Banana"}],
                "match_mode": "exact",
            },
            {
                "type": "trim",
                "sheets": ["明细"],
                "columns": {"names": ["备注"]},
            },
        ],
    }
    res = apply_operations(config)
    assert res["ok"]
    sheets = read_sheets(output_file)
    df = sheets["明细"]
    assert list(df["产品"]) == ["Apple", "Banana", "Apple"]
    assert list(df["数量"]) == [1, 2, 1]
    assert list(df["备注"]) == ["VIP 客户", "普通-客户", "VIP 客户"]


def test_idempotent_composition(tmp_path):
    input_file = make_excel(tmp_path)
    output_file1 = os.path.join(tmp_path, "output4.xlsx")
    output_file2 = os.path.join(tmp_path, "output5.xlsx")
    config = {
        "input_path": input_file,
        "output_path": output_file1,
        "operations": [
            {"type": "trim", "columns": {"names": ["姓名", "地址"]}},
            {"type": "remove_chars", "columns": {"names": ["地址"]}, "characters": ["-", "(", ")"]},
            {"type": "case", "columns": {"names": ["Code"]}, "mode": "upper"},
            {"type": "regex_replace", "columns": {"names": ["Code"]}, "pattern": "[A-Z]+", "replacement": "X"},
            {"type": "date_format", "columns": {"names": ["日期"]}, "output_format": "%Y/%m/%d"},
            {"type": "deduplicate", "subset": ["姓名", "Code"]},
            {"type": "bulk_replace", "columns": {"names": ["备注"]}, "mapping": [{"from": "VIP", "to": "VIP"}]},
        ],
    }
    res1 = apply_operations(config)
    assert res1["ok"]
    # Apply again on the produced file
    config2 = {**config, "input_path": output_file1, "output_path": output_file2}
    res2 = apply_operations(config2)
    assert res2["ok"]
    s1 = read_sheets(output_file1)
    s2 = read_sheets(output_file2)
    # Compare all sheets identical
    for name in s1:
        pd.testing.assert_frame_equal(s1[name], s2[name])
