"""Process 3 — explore the data behind a selected part of the diagram.

(r1)* + (r13) + (r15 selection) -> [tool translate] (r16 queries)*
-> [tool execute] (r17 result) + (r4_2 check statistics)
(-> [tool_2 translate] r18 chart happens in the browser)
"""
from __future__ import annotations

import sqlite3

import pandas as pd


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def load_sqlite(tables: dict[str, pd.DataFrame]) -> sqlite3.Connection:
    con = sqlite3.connect(":memory:", check_same_thread=False)
    for name, df in tables.items():
        df.to_sql(name, con, index=False)
    return con


def selection_to_sql(selection: dict, dm: dict) -> list[dict]:
    """[tool translate] r15 + r13 -> r16: SQL statements. Each has a purpose: 'result' or 'check'."""
    ents = {e["name"]: e for e in dm["entities"]}
    if selection["kind"] == "entity":
        e = ents[selection["id"]]
        t = q(e["name"])
        queries = [{"purpose": "check", "title": "row count", "sql": f"SELECT COUNT(*) AS value FROM {t}"}]
        if e.get("primary_key"):
            pk = q(e["primary_key"])
            queries.append({"purpose": "check", "title": f"duplicate {e['primary_key']} values",
                            "sql": f"SELECT COUNT(*) - COUNT(DISTINCT {pk}) AS value FROM {t}"})
            queries.append({"purpose": "check", "title": f"null {e['primary_key']} values",
                            "sql": f"SELECT COUNT(*) AS value FROM {t} WHERE {pk} IS NULL"})
        col = selection.get("column") or _chart_column(e)
        if col:
            c = q(col)
            queries.append({"purpose": "result", "title": f"distribution of {e['name']}.{col}",
                            "sql": f"SELECT {c} AS label, COUNT(*) AS value FROM {t} GROUP BY {c} ORDER BY value DESC LIMIT 15"})
        return queries
    rel = next(r for r in dm["relationships"] if r["id"] == selection["id"])
    ft, fc, tt, tc = q(rel["from_table"]), q(rel["from_column"]), q(rel["to_table"]), q(rel["to_column"])
    return [
        {"purpose": "check", "title": "child rows", "sql": f"SELECT COUNT(*) AS value FROM {ft}"},
        {"purpose": "check", "title": "orphan child rows (no matching parent)",
         "sql": f"SELECT COUNT(*) AS value FROM {ft} c LEFT JOIN {tt} p ON c.{fc} = p.{tc} WHERE c.{fc} IS NOT NULL AND p.{tc} IS NULL"},
        {"purpose": "check", "title": "parents without children",
         "sql": f"SELECT COUNT(*) AS value FROM {tt} p WHERE NOT EXISTS (SELECT 1 FROM {ft} c WHERE c.{fc} = p.{tc})"},
        {"purpose": "check", "title": "max children per parent",
         "sql": f"SELECT COALESCE(MAX(n), 0) AS value FROM (SELECT COUNT(*) AS n FROM {ft} GROUP BY {fc})"},
        {"purpose": "result", "title": f"children per {rel['to_table']} row (fan-out histogram)",
         "sql": f"SELECT CAST(n AS TEXT) AS label, COUNT(*) AS value FROM ("
                f"SELECT COUNT(c.{fc}) AS n FROM {tt} p LEFT JOIN {ft} c ON c.{fc} = p.{tc} GROUP BY p.{tc}"
                f") GROUP BY n ORDER BY n"},
    ]


def _chart_column(e: dict) -> str | None:
    """Pick the most chartable column: a category, else a non-key column with few distinct values."""
    cols = [c for c in e["columns"] if c["name"] != e.get("primary_key")]
    for pref in (lambda c: c["semantic_type"] == "category",
                 lambda c: c["role"] == "foreign_key",
                 lambda c: True):
        hit = [c for c in cols if pref(c)]
        if hit:
            return min(hit, key=lambda c: c["features"]["distinct_ratio"])["name"]
    return None


def execute_queries(con: sqlite3.Connection, queries: list[dict]) -> tuple[dict, list[dict]]:
    """[tool execute] r16 -> r17 (result table) + r4_2 (check statistics table)."""
    result = {"title": "", "columns": [], "rows": []}
    checks = []
    for item in queries:
        df = pd.read_sql_query(item["sql"], con)
        if item["purpose"] == "result":
            result = {"title": item["title"], "columns": list(df.columns),
                      "rows": df.astype(object).where(df.notna(), None).values.tolist()}
        else:
            checks.append({"check": item["title"], "value": None if df.empty else _py(df.iloc[0, 0])})
    return result, checks


def _py(v):
    return v.item() if hasattr(v, "item") else v
