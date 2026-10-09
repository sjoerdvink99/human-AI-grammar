"""Process 3 — Inspect Semantic Evidence.

[tool_1 translate]  selected_feature -> validation_queries (SQL)
[tool_1 execute]    validation_queries -> supporting_samples + counterexamples_2 (+ explanation)
"""
from __future__ import annotations

from .patterns import match_expr
from .store import Workspace, q

ROW_LIMIT = 25


def _qry(purpose: str, title: str, sql: str) -> dict:
    return {"purpose": purpose, "title": title, "sql": sql}


# --------------------------------------------------------------------------- [tool_1 translate]
def build_queries(selected: dict, profile: dict) -> list[dict]:
    kind = selected.get("kind")
    if kind == "column":
        t, c = selected["table"], selected["column"]
        col = next((x for x in profile["columns"] if x["table"] == t and x["column"] == c), None)
        if col is None:
            raise ValueError(f"unknown column {t}.{c}")
        qt, qc = q(t), q(c)
        out = [_qry("stat", "Column statistics",
                    f"SELECT count(*) AS rows, count({qc}) AS non_null, count(DISTINCT {qc}) AS distinct_values\nFROM {qt}")]
        pat = col.get("pattern")
        if pat:
            out.append(_qry("support", f"Values matching the '{pat}' pattern",
                            f"SELECT *\nFROM {qt}\nWHERE {qc} IS NOT NULL\n  AND {match_expr(c, pat)}"))
            out.append(_qry("counter", f"Values not matching the '{pat}' pattern",
                            f"SELECT *\nFROM {qt}\nWHERE {qc} IS NOT NULL\n  AND NOT {match_expr(c, pat)}"))
        if col.get("uniqueness", 0) >= 0.9 or col["category"] == "identifier" or [c] in profile_pk(profile, t):
            out.append(_qry("counter", "Duplicate values",
                            f"SELECT *\nFROM {qt}\nWHERE {qc} IN (\n  SELECT {qc} FROM {qt}\n  GROUP BY {qc} HAVING count(*) > 1)\nORDER BY {qc}"))
        out.append(_qry("counter", "Missing values", f"SELECT *\nFROM {qt}\nWHERE {qc} IS NULL"))
        return out
    if kind == "primary_key":
        t, cols = selected["table"], selected["columns"]
        qt, cl = q(t), ", ".join(q(c) for c in cols)
        nulls = " OR ".join(f"{q(c)} IS NULL" for c in cols)
        return [
            _qry("stat", "Key uniqueness", f"SELECT count(*) AS rows,\n  count(DISTINCT ({cl})) AS distinct_keys\nFROM {qt}"),
            _qry("support", "Rows identified by the key", f"SELECT *\nFROM {qt}\nORDER BY {cl}"),
            _qry("counter", "Rows sharing a key value",
                 f"SELECT *\nFROM {qt}\nWHERE ({cl}) IN (\n  SELECT ({cl}) FROM {qt}\n  GROUP BY {cl} HAVING count(*) > 1)\nORDER BY {cl}"
                 if len(cols) > 1 else
                 f"SELECT *\nFROM {qt}\nWHERE {cl} IN (\n  SELECT {cl} FROM {qt}\n  GROUP BY {cl} HAVING count(*) > 1)\nORDER BY {cl}"),
            _qry("counter", "Rows with a missing key", f"SELECT *\nFROM {qt}\nWHERE {nulls}"),
        ]
    if kind == "foreign_key":
        ft, fc, tt, tc = q(selected["from_table"]), q(selected["from_column"]), q(selected["to_table"]), q(selected["to_column"])
        return [
            _qry("stat", "Reference coverage",
                 f"SELECT count({fc}) AS references,\n  count({fc}) FILTER (WHERE {fc} IN (SELECT {tc} FROM {tt})) AS resolved,\n"
                 f"  (SELECT count(*) FROM {tt}) AS target_rows,\n"
                 f"  (SELECT count(DISTINCT {tc}) FROM {tt}) AS target_distinct\nFROM {ft}"),
            _qry("support", "Rows whose reference resolves",
                 f"SELECT c.*\nFROM {ft} c\nJOIN {tt} p ON c.{fc} = p.{tc}"),
            _qry("counter", "Dangling references (no matching target row)",
                 f"SELECT *\nFROM {ft}\nWHERE {fc} IS NOT NULL\n  AND {fc} NOT IN (SELECT {tc} FROM {tt} WHERE {tc} IS NOT NULL)"),
        ]
    if kind == "fd":
        t, a, b = q(selected["table"]), q(selected["lhs"]), q(selected["rhs"])
        return [
            _qry("stat", "Groups by determinant",
                 f"SELECT count(*) AS groups,\n  count(*) FILTER (WHERE n_rhs > 1) AS violating_groups\n"
                 f"FROM (SELECT {a}, count(DISTINCT {b}) AS n_rhs FROM {t}\n      WHERE {a} IS NOT NULL GROUP BY {a})"),
            _qry("support", f"Each {selected['lhs']} with its single {selected['rhs']}",
                 f"SELECT {a}, any_value({b}) AS {b}, count(*) AS rows\nFROM {t}\nWHERE {a} IS NOT NULL\nGROUP BY {a}\n"
                 f"HAVING count(DISTINCT {b}) <= 1\nORDER BY rows DESC"),
            _qry("counter", f"Rows where one {selected['lhs']} maps to several {selected['rhs']} values",
                 f"SELECT *\nFROM {t}\nWHERE {a} IN (\n  SELECT {a} FROM {t}\n  GROUP BY {a} HAVING count(DISTINCT {b}) > 1)\nORDER BY {a}, {b}"),
        ]
    raise ValueError(f"unknown selected feature kind '{kind}'")


def profile_pk(profile: dict, table: str) -> list[list[str]]:
    t = next((x for x in profile["tables"] if x["name"] == table), None)
    return [t["primary_key"]] if t and t["primary_key"] else []


# --------------------------------------------------------------------------- [tool_1 execute]
def execute_queries(ws: Workspace, selected: dict, queries: list[dict]) -> dict:
    support_rows, counter_rows, stats = [], [], {}
    support_total, counter_total = 0, 0
    for qd in queries:
        try:
            if qd["purpose"] == "stat":
                row = ws.rows(qd["sql"], 1)
                qd["result_rows"] = 1
                stats.update(row[0] if row else {})
            else:
                total = ws.scalar(f"SELECT count(*) FROM ({qd['sql']})")
                qd["result_rows"] = total
                rows = ws.rows(qd["sql"], ROW_LIMIT)
                if qd["purpose"] == "support":
                    support_total += total
                    support_rows.extend(rows[: ROW_LIMIT - len(support_rows)])
                else:
                    counter_total += total
                    for r in rows:
                        if len(counter_rows) < ROW_LIMIT:
                            counter_rows.append({"__reason": qd["title"], **r})
        except Exception as e:  # surface SQL errors in the view instead of failing the request
            qd["error"] = str(e)
    return {
        "supporting_samples": {"rows": support_rows, "total": support_total},
        "counterexamples": {"rows": counter_rows, "total": counter_total},
        "stats": stats,
        "explanation": explain(selected, stats, support_total, counter_total),
    }


def explain(sel: dict, stats: dict, support: int, counter: int) -> str:
    kind = sel["kind"]
    if kind == "column":
        rows, nn, d = stats.get("rows", 0), stats.get("non_null", 0), stats.get("distinct_values", 0)
        s = (f"{sel['table']}.{sel['column']} has {nn} non-empty values in {rows} rows "
             f"({d} distinct). ")
        if counter:
            s += f"{counter} record(s) contradict the inferred properties (pattern mismatches, duplicates or missing values)."
        else:
            s += "No record contradicts the inferred properties."
        return s
    if kind == "primary_key":
        rows, d = stats.get("rows", 0), stats.get("distinct_keys", 0)
        key = ", ".join(sel["columns"])
        if counter == 0:
            return f"({key}) identifies all {rows} rows of {sel['table']}: every value is present and distinct."
        return f"({key}) is not a valid key of {sel['table']}: {counter} row(s) share a key value or miss one ({d} distinct keys for {rows} rows)."
    if kind == "foreign_key":
        refs, res = stats.get("references", 0), stats.get("resolved", 0)
        pct = f" ({res / refs:.1%})" if refs else ""
        s = (f"{res} of {refs} non-empty {sel['from_table']}.{sel['from_column']} values{pct} "
             f"resolve to a row of {sel['to_table']}.{sel['to_column']}. ")
        if stats.get("target_rows") and stats.get("target_distinct") != stats.get("target_rows"):
            s += "Warning: the target column is not unique, so it is not a key. "
        s += f"{counter} dangling reference(s)." if counter else "There are no dangling references."
        return s
    if kind == "fd":
        g, v = stats.get("groups", 0), stats.get("violating_groups", 0)
        if v == 0:
            return f"In {sel['table']}, every one of the {g} {sel['lhs']} values maps to exactly one {sel['rhs']}: {sel['lhs']} → {sel['rhs']} holds."
        return (f"{v} of {g} {sel['lhs']} values map to more than one {sel['rhs']} ({counter} rows involved): "
                f"{sel['lhs']} → {sel['rhs']} does not hold exactly.")
    return ""


