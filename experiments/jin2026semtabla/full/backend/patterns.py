"""Value patterns used by tool_1 for detection and profiling. Ordered from most to least specific.
Regexes are RE2-compatible because DuckDB evaluates them (regexp_full_match)."""
from __future__ import annotations

from .store import lit, q

PATTERNS: list[tuple[str, str]] = [
    ("boolean", r"(?i)(true|false|t|f|yes|no|y|n)"),
    ("integer", r"[-+]?[0-9]+"),
    ("decimal", r"[-+]?[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?"),
    ("iso_date", r"[0-9]{4}-[0-9]{2}-[0-9]{2}"),
    ("datetime", r"[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?.*"),
    ("email", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    ("url", r"(?i)https?://[^\s]+"),
    ("phone", r"\+?[0-9][0-9 ()\-]{6,}[0-9]"),
    ("code", r"[A-Z0-9]+([-_/][A-Z0-9]+)*"),
    ("word", r"[A-Za-z][A-Za-z'\-]*"),
    ("words", r"[A-Za-z][A-Za-z'\-]*( [A-Za-z0-9'\-]+){1,4}"),
    ("text", r"(?s).*\s.*\s.*\s.*"),
]
PATTERN_RE = dict(PATTERNS)


def match_expr(column: str, pattern: str) -> str:
    """SQL boolean: does the column's text form match the named pattern."""
    expr = f"CAST({q(column)} AS VARCHAR)"
    if pattern == "decimal":
        # integers stored in a float column render as '5.0', integers count as decimals too
        return (f"(regexp_full_match({expr}, {lit(PATTERN_RE['decimal'])}) OR "
                f"regexp_full_match({expr}, {lit(PATTERN_RE['integer'])}))")
    return f"regexp_full_match({expr}, {lit(PATTERN_RE[pattern])})"
