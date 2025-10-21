import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import jsonschema
import pandas as pd
from pandas import DataFrame

from .schema import CLEAN_SCHEMA


class BatchCleanError(Exception):
    pass


@dataclass
class ValidationIssue:
    message: str
    path: List[str]


def validate_config(config: Dict[str, Any]) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []
    try:
        jsonschema.validate(instance=config, schema=CLEAN_SCHEMA)
    except jsonschema.ValidationError as e:
        path = [str(p) for p in list(e.path)]
        issues.append(ValidationIssue(message=e.message, path=path))
    return issues


def excel_col_to_index(col: str) -> int:
    col = col.strip().upper()
    n = 0
    for ch in col:
        if not ('A' <= ch <= 'Z'):
            raise ValueError(f"Invalid excel column: {col}")
        n = n * 26 + (ord(ch) - ord('A') + 1)
    return n - 1


def parse_excel_range(rng: str) -> Tuple[int, int]:
    start, end = rng.split(":", 1)
    i0 = excel_col_to_index(start)
    i1 = excel_col_to_index(end)
    if i1 < i0:
        i0, i1 = i1, i0
    return i0, i1


def resolve_columns(columns_spec: Optional[Dict[str, Any]], df: DataFrame) -> List[str]:
    if columns_spec is None:
        return list(df.columns)
    cols: List[str] = []
    if "names" in columns_spec:
        for name in columns_spec["names"]:
            if name in df.columns:
                cols.append(name)
    if "indices" in columns_spec:
        for idx in columns_spec["indices"]:
            if 0 <= idx < len(df.columns):
                cols.append(df.columns[idx])
    if "excel_range" in columns_spec:
        i0, i1 = parse_excel_range(columns_spec["excel_range"])
        for i in range(i0, min(i1 + 1, len(df.columns))):
            cols.append(df.columns[i])
    # Deduplicate while preserving order
    seen = set()
    uniq_cols: List[str] = []
    for c in cols:
        if c not in seen:
            seen.add(c)
            uniq_cols.append(c)
    return uniq_cols


def resolve_sheets(sheets_spec: Optional[Sequence[Any]], xls: pd.ExcelFile) -> List[str]:
    if sheets_spec is None:
        return list(xls.sheet_names)
    resolved: List[str] = []
    for s in sheets_spec:
        if isinstance(s, int):
            if 0 <= s < len(xls.sheet_names):
                resolved.append(xls.sheet_names[s])
        else:
            if s in xls.sheet_names:
                resolved.append(s)
    # Deduplicate
    seen = set()
    out: List[str] = []
    for s in resolved:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _to_str_series(series: pd.Series) -> pd.Series:
    # Preserve NaN/None; operate only on string-likes
    return series.astype("object").where(series.isna(), series.astype("object"))


def op_trim(df: DataFrame, cols: List[str]) -> DataFrame:
    for c in cols:
        if c in df.columns:
            s = df[c]
            if pd.api.types.is_string_dtype(s) or s.dtype == object:
                df[c] = s.astype("object").where(s.isna(), s.astype("string").str.strip())
    return df


def op_remove_chars(df: DataFrame, cols: List[str], characters: Iterable[str]) -> DataFrame:
    chars = characters if isinstance(characters, (list, tuple)) else [characters]
    chars_joined = "".join(chars)
    if not chars_joined:
        return df
    pattern = f"[{re.escape(chars_joined)}]+"
    for c in cols:
        if c in df.columns:
            s = df[c]
            if pd.api.types.is_string_dtype(s) or s.dtype == object:
                df[c] = s.astype("object").where(
                    s.isna(), s.astype("string").str.replace(pattern, "", regex=True)
                )
    return df


def _compile_flags(flags: Sequence[str]) -> int:
    m = 0
    for fl in flags:
        if fl == "IGNORECASE":
            m |= re.IGNORECASE
        elif fl == "MULTILINE":
            m |= re.MULTILINE
        elif fl == "DOTALL":
            m |= re.DOTALL
        elif fl == "UNICODE":
            m |= re.UNICODE
    return m


def op_regex_replace(
    df: DataFrame, cols: List[str], pattern: str, replacement: str, flags: Sequence[str]
) -> DataFrame:
    flags_compiled = _compile_flags(flags)
    for c in cols:
        if c in df.columns:
            s = df[c]
            if pd.api.types.is_string_dtype(s) or s.dtype == object:
                df[c] = s.astype("object").where(
                    s.isna(), s.astype("string").str.replace(pattern, replacement, regex=True, flags=flags_compiled)
                )
    return df


def op_case(df: DataFrame, cols: List[str], mode: str) -> DataFrame:
    for c in cols:
        if c in df.columns:
            s = df[c]
            if pd.api.types.is_string_dtype(s) or s.dtype == object:
                if mode == "lower":
                    df[c] = s.astype("object").where(s.isna(), s.astype("string").str.lower())
                elif mode == "upper":
                    df[c] = s.astype("object").where(s.isna(), s.astype("string").str.upper())
                elif mode == "title":
                    df[c] = s.astype("object").where(s.isna(), s.astype("string").str.title())
                elif mode == "capitalize":
                    df[c] = s.astype("object").where(s.isna(), s.astype("string").str.capitalize())
    return df


def op_date_format(
    df: DataFrame,
    cols: List[str],
    output_format: str,
    input_formats: Optional[Sequence[Optional[str]]],
    errors: str,
) -> DataFrame:
    for c in cols:
        if c in df.columns:
            s = df[c]
            # Try parse using pandas to_datetime with optional format; we handle multiple formats by trying sequentially
            ser = s
            if not (pd.api.types.is_datetime64_any_dtype(s) or pd.api.types.is_string_dtype(s) or s.dtype == object):
                continue
            parsed = None
            if input_formats:
                for fmt in input_formats:
                    try:
                        parsed = pd.to_datetime(ser, format=fmt, errors="coerce")
                    except Exception:
                        parsed = pd.to_datetime(ser, errors="coerce")
                    ser = parsed.where(parsed.notna(), ser)
                parsed = pd.to_datetime(ser, errors="coerce")
            else:
                parsed = pd.to_datetime(ser, errors="coerce")
            if errors == "raise":
                if parsed.isna().any():
                    bad_idx = list(parsed[parsed.isna()].index[:5])
                    raise BatchCleanError(
                        f"date_format encountered unparsable values in column '{c}' at rows {bad_idx}"
                    )
            if errors == "ignore":
                # Leave original where parse failed
                formatted = parsed.dt.strftime(output_format)
                df[c] = pd.Series(
                    [formatted.iloc[i] if not pd.isna(parsed.iloc[i]) else s.iloc[i] for i in range(len(s))],
                    index=s.index,
                )
            else:
                # coerce -> NaT to NaN string
                formatted = parsed.dt.strftime(output_format)
                df[c] = formatted
    return df


def op_deduplicate(df: DataFrame, subset: Optional[Sequence[Any]], keep: Any) -> DataFrame:
    subset_cols: Optional[List[str]] = None
    if subset is not None:
        subset_cols = []
        for item in subset:
            if isinstance(item, int):
                if 0 <= item < len(df.columns):
                    subset_cols.append(df.columns[item])
            else:
                if item in df.columns:
                    subset_cols.append(item)
        if not subset_cols:
            subset_cols = None
    return df.drop_duplicates(subset=subset_cols, keep=keep)


def op_bulk_replace(
    df: DataFrame,
    cols: List[str],
    mapping: Sequence[Dict[str, str]],
    match_mode: str,
) -> DataFrame:
    if match_mode == "exact":
        repl_map = {m["from"]: m["to"] for m in mapping}
        for c in cols:
            if c in df.columns:
                s = df[c]
                if pd.api.types.is_string_dtype(s) or s.dtype == object:
                    df[c] = s.replace(repl_map)
    else:  # substring
        for c in cols:
            if c in df.columns:
                s = df[c]
                if pd.api.types.is_string_dtype(s) or s.dtype == object:
                    series = s.astype("object")
                    mask = ~series.isna()
                    values = series.astype("string")
                    for m in mapping:
                        values = values.str.replace(m["from"], m["to"], regex=False)
                    df[c] = series.where(~mask, values)
    return df


OP_HANDLERS = {
    "trim": lambda df, op, cols: op_trim(df, cols),
    "remove_chars": lambda df, op, cols: op_remove_chars(df, cols, op.get("characters", "")),
    "regex_replace": lambda df, op, cols: op_regex_replace(
        df, cols, op.get("pattern", ""), op.get("replacement", ""), op.get("flags", [])
    ),
    "case": lambda df, op, cols: op_case(df, cols, op.get("mode", "lower")),
    "date_format": lambda df, op, cols: op_date_format(
        df, cols, op.get("output_format"), op.get("input_formats"), op.get("errors", "coerce")
    ),
    # deduplicate handled separately as it doesn't use columns
    "bulk_replace": lambda df, op, cols: op_bulk_replace(
        df, cols, op.get("mapping", []), op.get("match_mode", "exact")
    ),
}


def apply_operations(config: Dict[str, Any]) -> Dict[str, Any]:
    issues = validate_config(config)
    if issues:
        return {
            "ok": False,
            "errors": [
                {"message": i.message, "path": i.path} for i in issues
            ],
        }

    input_path = config.get("input_path")
    output_path = config.get("output_path")

    xls = pd.ExcelFile(input_path) if input_path else None

    # Load all sheets
    sheets_data: Dict[str, DataFrame] = {}
    if xls:
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name, dtype=object)
            sheets_data[sheet_name] = df
    else:
        # If no input path provided, operate on empty set -> error
        raise BatchCleanError("input_path is required to apply operations")

    operations: List[Dict[str, Any]] = config.get("operations", [])

    for op in operations:
        op_type = op.get("type")
        target_sheets = resolve_sheets(op.get("sheets"), xls)
        if op_type == "deduplicate":
            for sheet in target_sheets:
                if sheet not in sheets_data:
                    continue
                df = sheets_data[sheet]
                df2 = op_deduplicate(df, op.get("subset"), op.get("keep", "first"))
                sheets_data[sheet] = df2
            continue
        # Column-based operations
        handler = OP_HANDLERS.get(op_type)
        if not handler:
            raise BatchCleanError(f"Unsupported operation type: {op_type}")
        for sheet in target_sheets:
            if sheet not in sheets_data:
                continue
            df = sheets_data[sheet]
            cols = resolve_columns(op.get("columns"), df)
            df2 = handler(df.copy(), op, cols)
            sheets_data[sheet] = df2

    # Write output
    if not output_path:
        raise BatchCleanError("output_path is required to apply operations")
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        for sheet_name, df in sheets_data.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)

    return {"ok": True, "output_path": output_path}
