CLEAN_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://example.com/excel-batch-clean.schema.json",
    "title": "Excel Batch Cleaning Config",
    "type": "object",
    "properties": {
        "input_path": {"type": "string"},
        "output_path": {"type": "string"},
        "operations": {
            "type": "array",
            "items": {
                "type": "object",
                "oneOf": [
                    {  # Trim
                        "properties": {
                            "type": {"const": "trim"},
                            "sheets": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                            },
                            "columns": {"$ref": "#/$defs/columns"},
                        },
                        "required": ["type"],
                        "additionalProperties": False,
                    },
                    {  # Remove characters
                        "properties": {
                            "type": {"const": "remove_chars"},
                            "sheets": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                            },
                            "columns": {"$ref": "#/$defs/columns"},
                            "characters": {
                                "oneOf": [
                                    {"type": "string"},
                                    {"type": "array", "items": {"type": "string"}},
                                ]
                            },
                        },
                        "required": ["type", "characters"],
                        "additionalProperties": False,
                    },
                    {  # Regex replace
                        "properties": {
                            "type": {"const": "regex_replace"},
                            "sheets": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                            },
                            "columns": {"$ref": "#/$defs/columns"},
                            "pattern": {"type": "string"},
                            "replacement": {"type": "string", "default": ""},
                            "flags": {
                                "type": "array",
                                "items": {
                                    "enum": ["IGNORECASE", "MULTILINE", "DOTALL", "UNICODE"]
                                },
                                "default": [],
                            },
                        },
                        "required": ["type", "pattern"],
                        "additionalProperties": False,
                    },
                    {  # Case normalization
                        "properties": {
                            "type": {"const": "case"},
                            "sheets": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                            },
                            "columns": {"$ref": "#/$defs/columns"},
                            "mode": {"enum": ["lower", "upper", "title", "capitalize"]},
                        },
                        "required": ["type", "mode"],
                        "additionalProperties": False,
                    },
                    {  # Date standardization
                        "properties": {
                            "type": {"const": "date_format"},
                            "sheets": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                            },
                            "columns": {"$ref": "#/$defs/columns"},
                            "output_format": {"type": "string"},
                            "input_formats": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "null"]},
                                "default": None,
                            },
                            "errors": {"enum": ["coerce", "raise", "ignore"], "default": "coerce"},
                        },
                        "required": ["type", "output_format"],
                        "additionalProperties": False,
                    },
                    {  # Deduplication
                        "properties": {
                            "type": {"const": "deduplicate"},
                            "sheets": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                            },
                            "subset": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                                "default": None,
                            },
                            "keep": {"enum": ["first", "last", False], "default": "first"},
                        },
                        "required": ["type"],
                        "additionalProperties": False,
                    },
                    {  # Bulk replace
                        "properties": {
                            "type": {"const": "bulk_replace"},
                            "sheets": {
                                "type": ["array", "null"],
                                "items": {"type": ["string", "integer"]},
                            },
                            "columns": {"$ref": "#/$defs/columns"},
                            "mapping": {
                                "type": "array",
                                "minItems": 1,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "from": {"type": "string"},
                                        "to": {"type": "string"},
                                    },
                                    "required": ["from", "to"],
                                    "additionalProperties": False,
                                },
                            },
                            "match_mode": {"enum": ["exact", "substring"], "default": "exact"},
                        },
                        "required": ["type", "mapping"],
                        "additionalProperties": False,
                    },
                ],
            },
        },
    },
    "required": ["operations"],
    "additionalProperties": False,
    "$defs": {
        "columns": {
            "type": ["object", "null"],
            "default": None,
            "properties": {
                "names": {"type": "array", "items": {"type": "string"}},
                "indices": {"type": "array", "items": {"type": "integer", "minimum": 0}},
                "excel_range": {"type": "string", "pattern": "^[A-Za-z]+:[A-Za-z]+$"},
            },
            "anyOf": [
                {"required": ["names"]},
                {"required": ["indices"]},
                {"required": ["excel_range"]},
            ],
            "additionalProperties": False,
        }
    },
}
