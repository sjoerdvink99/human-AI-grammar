"""Shared feature semantics: how a feature record is detected from values and how it
translates into SQL conditions (used by process 1 evaluate and process 3 translate)."""
import re
from datetime import date

from store import qi, ql

# ordered from most to least specific; RE2/Python-compatible
PATTERNS = [
    ("uuid", r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"),
    ("email", r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}"),
    ("url", r"https?://[^\s]+"),
    ("iso_date", r"[0-9]{4}-[0-9]{2}-[0-9]{2}"),
    ("upper_code2", r"[A-Z]{2}"),
    ("upper_code3", r"[A-Z]{3}"),
    ("alnum_code", r"[A-Z]{2,5}-?[0-9]{2,8}"),
    ("phone", r"\+?[0-9][0-9 ()\-]{6,19}"),
]
PATTERN_RE = dict(PATTERNS)


def is_numeric_dtype(dtype: str) -> bool:
    d = dtype.upper()
    return any(t in d for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "REAL", "NUMERIC"))


def is_integer_dtype(dtype: str) -> bool:
    return "INT" in dtype.upper()


def value_type(values, dtype):
    """Infer the value type of a column from its sample values."""
    d = dtype.upper()
    if is_integer_dtype(d):
        return "integer"
    if is_numeric_dtype(d):
        return "decimal"
    if d.startswith("TIMESTAMP"):
        return "datetime"
    if d == "DATE":
        return "date"
    if d == "BOOLEAN":
        return "boolean"
    strs = [str(v) for v in values]
    if strs and all(re.fullmatch(r"-?\d+", s) for s in strs):
        return "integer"
    if strs and all(re.fullmatch(r"-?\d+(\.\d+)?", s) for s in strs):
        return "decimal"
    if strs and all(s.lower() in ("true", "false", "yes", "no", "y", "n") for s in strs):
        return "boolean"
    if strs and all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) for s in strs):
        try:
            [date.fromisoformat(s) for s in strs]
            return "date"
        except ValueError:
            pass
    return "text"


CAST = {"integer": "BIGINT", "decimal": "DOUBLE", "date": "DATE", "datetime": "TIMESTAMP", "boolean": "BOOLEAN"}


def detect_column_features(table, column, dtype, values, round_no):
    """tool_1 extract: candidate features that hold on all sample values of one column."""
    feats = []
    n = len(values)
    nonnull = [v for v in values if v is not None and v != ""]

    def add(kind, params, description):
        feats.append({"id": f"{table}.{column}.{kind}", "table": table, "column": column,
                      "kind": kind, "params": params, "description": description, "round": round_no})

    if n == 0:
        return feats
    if len(nonnull) == n:
        add("not_null", {}, f"{column} is never null")
    if not nonnull:
        return feats
    if len(nonnull) >= 10 and len(set(map(str, nonnull))) == len(nonnull):
        add("unique", {}, f"{column} values are unique")
    vt = value_type(nonnull, dtype)
    add("type", {"type": vt}, f"{column} values are {vt}")
    if vt in ("integer", "decimal"):
        nums = [float(v) for v in nonnull]
        lo, hi = min(nums), max(nums)
        if vt == "integer":
            lo, hi = int(lo), int(hi)
        add("range", {"min": lo, "max": hi}, f"{column} lies in [{lo}, {hi}]")
    if vt == "text":
        strs = [str(v) for v in nonnull]
        for pname, rx in PATTERNS:
            if all(re.fullmatch(rx, s) for s in strs):
                add("pattern", {"name": pname, "regex": rx}, f"{column} matches {pname} pattern")
                break
    distinct = sorted(set(map(str, nonnull)))
    if vt in ("text", "integer", "boolean") and len(nonnull) >= 10 and len(distinct) <= 8 \
            and len(distinct) / len(nonnull) <= 0.3:
        add("domain", {"values": distinct}, f"{column} ∈ {{{', '.join(distinct)}}}")
    elif vt == "text":
        lens = [len(str(v)) for v in nonnull]
        add("length", {"min": min(lens), "max": max(lens)}, f"len({column}) in [{min(lens)}, {max(lens)}]")
    return feats


def feature_conditions(feature):
    """Return (support_where, violation_where) SQL conditions for a feature."""
    t, c, k, p = qi(feature["table"]), qi(feature["column"]), feature["kind"], feature["params"]
    s = f"CAST({c} AS VARCHAR)"
    if k == "not_null":
        return f"{c} IS NOT NULL", f"{c} IS NULL"
    if k == "unique":
        dup = f"{c} IN (SELECT {c} FROM {t} WHERE {c} IS NOT NULL GROUP BY {c} HAVING COUNT(*) > 1)"
        return f"{c} IS NOT NULL AND NOT ({dup})", dup
    if k == "type":
        cast = CAST.get(p["type"])
        if not cast:
            return f"{c} IS NOT NULL", "FALSE"
        ok = f"TRY_CAST({s} AS {cast}) IS NOT NULL"
        return f"{c} IS NOT NULL AND {ok}", f"{c} IS NOT NULL AND NOT ({ok})"
    if k == "range":
        num = f"TRY_CAST({s} AS DOUBLE)"
        ok = f"{num} BETWEEN {p['min']} AND {p['max']}"
        return f"{c} IS NOT NULL AND {ok}", f"{c} IS NOT NULL AND NOT ({ok})"
    if k == "pattern":
        ok = f"regexp_full_match({s}, {ql(p['regex'])})"
        return f"{c} IS NOT NULL AND {ok}", f"{c} IS NOT NULL AND NOT ({ok})"
    if k == "domain":
        ok = f"{s} IN ({', '.join(ql(v) for v in p['values'])})"
        return f"{c} IS NOT NULL AND {ok}", f"{c} IS NOT NULL AND NOT ({ok})"
    if k == "length":
        ok = f"length({s}) BETWEEN {p['min']} AND {p['max']}"
        return f"{c} IS NOT NULL AND {ok}", f"{c} IS NOT NULL AND NOT ({ok})"
    raise ValueError(f"unknown feature kind {k}")
