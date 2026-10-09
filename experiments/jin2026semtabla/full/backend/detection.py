"""Process 1 — Counterexample-Guided Feature Detection (tool_1).

samples_1 are DuckDB tables `__s_<table>` (with the source rowid in `__rid`), so extraction on
samples and evaluation on the full data run the same SQL against different relations.
"""
from __future__ import annotations

import re
from itertools import combinations

from .patterns import PATTERNS, match_expr
from .store import Workspace, lit, q, sample_name

KEYABLE_TYPES = ("BIGINT", "INTEGER", "SMALLINT", "TINYINT", "HUGEINT", "UBIGINT", "UINTEGER", "VARCHAR", "DATE")
MAX_COUNTEREXAMPLES_PER_FEATURE = 20


def _family(t: str) -> str:
    t = t.upper()
    if "INT" in t:
        return "int"
    if t.startswith("VARCHAR"):
        return "text"
    if t in ("DOUBLE", "FLOAT", "REAL") or t.startswith("DECIMAL"):
        return "float"
    if t.startswith("BOOL"):
        return "bool"
    if t.startswith("DATE") or t.startswith("TIMESTAMP"):
        return "time"
    return "other"


def feature_id(f: dict) -> str:
    if f["kind"] == "inclusion":
        return f"inclusion:{f['table']}.{f['columns'][0]}->{f['ref_table']}.{f['ref_columns'][0]}"
    if f["kind"] == "fd":
        return f"fd:{f['table']}({f['columns'][0]}->{f['rhs']})"
    if f["kind"] == "pattern":
        return f"pattern:{f['table']}.{f['columns'][0]}={f['pattern']}"
    return f"{f['kind']}:{f['table']}({','.join(f['columns'])})"


def _feature(kind, table, columns, **extra):
    f = {"kind": kind, "table": table, "columns": list(columns), **extra}
    f["id"] = feature_id(f)
    return f


# --------------------------------------------------------------------------- [tool_1 select]
def select_samples(ws: Workspace, sample_size: int, seed: int = 42) -> dict:
    sizes = {}
    for t in ws.table_names:
        s = sample_name(t)
        ws.con.execute(f"DROP TABLE IF EXISTS {q(s)}")
        ws.con.execute(
            f"CREATE TABLE {q(s)} AS SELECT * FROM (SELECT rowid AS __rid, * FROM {q(t)}) "
            f"USING SAMPLE reservoir({int(sample_size)} ROWS) REPEATABLE ({int(seed)})"
        )
    complete_references(ws)
    for t in ws.table_names:
        sizes[t] = ws.row_count(sample_name(t))
    return sizes


def complete_references(ws: Workspace) -> None:
    """Join-aware sampling: for every name-linked column pair (child.c, parent.pc), add the parent
    rows whose pc value occurs in the child sample, so true inclusion dependencies stay visible
    in the samples while dangling references remain absent."""
    types = {t: dict(ws.columns(t)) for t in ws.table_names}
    for child in ws.table_names:
        for c, typ in types[child].items():
            for parent in ws.table_names:
                if parent == child:
                    continue
                for pc, ptyp in types[parent].items():
                    if _family(typ) != _family(ptyp) or _family(typ) not in ("int", "text"):
                        continue
                    if not _names_link(c, parent, pc):
                        continue
                    ps = q(sample_name(parent))
                    n, d = ws.con.execute(f"SELECT count(*), count(DISTINCT {q(pc)}) FROM {ps}").fetchone()
                    if n == 0 or d != n:
                        continue  # only complete towards columns that look like keys in the parent sample
                    ws.con.execute(
                        f"INSERT INTO {ps} SELECT * FROM (SELECT rowid AS __rid, * FROM {q(parent)}) "
                        f"WHERE {q(pc)} IN (SELECT {q(c)} FROM {q(sample_name(child))}) "
                        f"AND __rid NOT IN (SELECT __rid FROM {ps}) LIMIT 1000"
                    )


# --------------------------------------------------------------------------- [tool_1 extract]
def _stem(table: str) -> str:
    t = table.lower()
    if t.endswith("ies"):
        return t[:-3] + "y"
    if t.endswith("ses"):
        return t[:-2]
    if t.endswith("s"):
        return t[:-1]
    return t


def _names_link(child_col: str, parent_table: str, parent_col: str) -> bool:
    c, p, stem = child_col.lower(), parent_col.lower(), _stem(parent_table)
    if c == p and c not in ("id", "name", "code"):
        return True
    if p in ("id", "key", "code") and c in (f"{stem}_{p}", f"{stem}{p}"):
        return True
    for suffix in ("_id", "_code", "_key", "_ref"):
        if p.endswith(suffix) and c.endswith(p):  # e.g. billing_customer_id -> customer_id
            return True
    return False


def extract_features(ws: Workspace, relation=sample_name) -> list[dict]:
    """Detect candidate features on the given relations (samples by default)."""
    feats: list[dict] = []
    unique_cols: dict[str, list[str]] = {}
    col_types: dict[str, dict[str, str]] = {}
    for t in ws.table_names:
        r = q(relation(t))
        cols = ws.columns(t, relation(t))
        col_types[t] = dict(cols)
        n = ws.scalar(f"SELECT count(*) FROM {r}")
        if n == 0:
            continue
        stats = {}
        for c, typ in cols:
            nonnull, distinct = ws.con.execute(f"SELECT count({q(c)}), count(DISTINCT {q(c)}) FROM {r}").fetchone()
            stats[c] = (nonnull, distinct, typ)
            if nonnull == n:
                feats.append(_feature("not_null", t, [c]))
            if nonnull == n and distinct == n and n >= 2 and _family(typ) in ("int", "text", "time"):
                feats.append(_feature("unique", t, [c]))
                unique_cols.setdefault(t, []).append(c)
            if nonnull > 0 and _family(typ) in ("int", "text", "float", "time", "bool"):
                for pname, _ in PATTERNS:
                    bad = ws.scalar(f"SELECT count(*) FROM {r} WHERE {q(c)} IS NOT NULL AND NOT {match_expr(c, pname)}")
                    if bad == 0:
                        feats.append(_feature("pattern", t, [c], pattern=pname))
                        break
        # composite keys (pairs) only when no single column is unique
        if t not in unique_cols and n >= 2:
            keyable = [c for c, typ in cols if _family(typ) in ("int", "text", "time") and stats[c][0] == n][:12]
            for a, b in combinations(keyable, 2):
                d = ws.scalar(f"SELECT count(*) FROM (SELECT DISTINCT {q(a)}, {q(b)} FROM {r})")
                if d == n:
                    feats.append(_feature("unique", t, [a, b]))
        # single-column functional dependencies lhs -> rhs
        lhs_cands = [c for c, (nn, d, typ) in stats.items()
                     if _family(typ) in ("int", "text", "bool", "time") and 1 < d <= max(2, 0.5 * n) and nn > 0]
        rhs_cands = [c for c, (nn, d, typ) in stats.items() if d > 1 and d < n]
        for a in lhs_cands:
            others = [b for b in rhs_cands if b != a and stats[b][1] <= stats[a][1] * 1]
            if not others:
                continue
            aggs = ", ".join(f"count(DISTINCT {q(b)}) AS {q('d_' + b)}" for b in others)
            row = ws.con.execute(
                f"SELECT {', '.join('max(' + q('d_' + b) + ')' for b in others)} FROM "
                f"(SELECT {q(a)}, {aggs} FROM {r} WHERE {q(a)} IS NOT NULL GROUP BY {q(a)})"
            ).fetchone()
            for b, mx in zip(others, row):
                if mx is not None and mx <= 1 and stats[b][1] > 1:
                    feats.append(_feature("fd", t, [a], rhs=b))
    # inclusion dependencies child.col ⊆ parent.unique_col
    for child in ws.table_names:
        for c, typ in col_types.get(child, {}).items():
            for parent, pcols in unique_cols.items():
                if parent == child:
                    continue
                for pc in pcols:
                    ptyp = col_types[parent][pc]
                    if _family(typ) != _family(ptyp) or _family(typ) not in ("int", "text"):
                        continue
                    if not _names_link(c, parent, pc):
                        continue
                    nonnull = ws.scalar(f"SELECT count({q(c)}) FROM {q(relation(child))}")
                    if not nonnull:
                        continue
                    missing = ws.scalar(
                        f"SELECT count(*) FROM {q(relation(child))} WHERE {q(c)} IS NOT NULL AND {q(c)} NOT IN "
                        f"(SELECT {q(pc)} FROM {q(relation(parent))} WHERE {q(pc)} IS NOT NULL)"
                    )
                    if missing == 0:
                        feats.append(_feature("inclusion", child, [c], ref_table=parent, ref_columns=[pc]))
    return feats


# --------------------------------------------------------------------------- violation SQL (shared with process 3)
def violation_sql(f: dict, distinct_witnesses: bool = False) -> str:
    """SQL selecting full-data rows (with rowid as __rid) that contradict feature f."""
    t = q(f["table"])
    base = f"(SELECT rowid AS __rid, * FROM {t})"
    cols = f["columns"]
    if f["kind"] == "not_null":
        return f"SELECT * FROM {base} WHERE {q(cols[0])} IS NULL"
    if f["kind"] == "pattern":
        return f"SELECT * FROM {base} WHERE {q(cols[0])} IS NOT NULL AND NOT {match_expr(cols[0], f['pattern'])}"
    if f["kind"] == "unique":
        cl = ", ".join(q(c) for c in cols)
        sql = (f"SELECT * FROM {base} WHERE ({cl}) IN (SELECT ({cl}) FROM {t} GROUP BY {cl} HAVING count(*) > 1)")
        if len(cols) == 1:
            sql = (f"SELECT * FROM {base} WHERE {q(cols[0])} IN "
                   f"(SELECT {q(cols[0])} FROM {t} GROUP BY {q(cols[0])} HAVING count(*) > 1)")
        if distinct_witnesses:
            sql += f" QUALIFY row_number() OVER (PARTITION BY {cl} ORDER BY __rid) <= 2"
        return sql + f" ORDER BY {cl}, __rid"
    if f["kind"] == "fd":
        a, b = q(cols[0]), q(f["rhs"])
        sql = (f"SELECT * FROM {base} WHERE {a} IN "
               f"(SELECT {a} FROM {t} WHERE {a} IS NOT NULL GROUP BY {a} HAVING count(DISTINCT {b}) > 1)")
        if distinct_witnesses:
            sql += f" QUALIFY row_number() OVER (PARTITION BY {a}, {b} ORDER BY __rid) = 1"
        return sql + f" ORDER BY {a}, __rid"
    if f["kind"] == "inclusion":
        c, p, pc = q(cols[0]), q(f["ref_table"]), q(f["ref_columns"][0])
        return (f"SELECT * FROM {base} WHERE {c} IS NOT NULL AND {c} NOT IN "
                f"(SELECT {pc} FROM {p} WHERE {pc} IS NOT NULL)")
    raise ValueError(f"unknown feature kind {f['kind']}")


# --------------------------------------------------------------------------- [tool_1 evaluate]
def evaluate_features(ws: Workspace, features: list[dict]) -> dict[str, dict]:
    """counterexamples_1: for each refuted feature, the count and witness rows from the full data."""
    out = {}
    for f in features:
        total = ws.scalar(f"SELECT count(*) FROM ({violation_sql(f)})")
        if total:
            witnesses = ws.con.execute(
                f"SELECT __rid FROM ({violation_sql(f, distinct_witnesses=True)}) LIMIT {MAX_COUNTEREXAMPLES_PER_FEATURE}"
            ).fetchall()
            out[f["id"]] = {
                "feature": f,
                "count": total,
                "rowids": [w[0] for w in witnesses],
                "rows": ws.rows(f"SELECT * FROM ({violation_sql(f, True)})", 5),
            }
    return out


# --------------------------------------------------------------------------- [tool_1 expand]
def expand_samples(ws: Workspace, counterexamples: dict[str, dict]) -> dict[str, int]:
    added: dict[str, int] = {}
    by_table: dict[str, set] = {}
    for ce in counterexamples.values():
        by_table.setdefault(ce["feature"]["table"], set()).update(ce["rowids"])
    for t, rids in by_table.items():
        s = q(sample_name(t))
        before = ws.row_count(sample_name(t))
        ids = ", ".join(str(int(r)) for r in sorted(rids))
        ws.con.execute(
            f"INSERT INTO {s} SELECT * FROM (SELECT rowid AS __rid, * FROM {q(t)}) "
            f"WHERE __rid IN ({ids}) AND __rid NOT IN (SELECT __rid FROM {s})"
        )
        added[t] = ws.row_count(sample_name(t)) - before
    complete_references(ws)
    return added


# --------------------------------------------------------------------------- loop
def run_detection(ws: Workspace, sample_size: int = 200, max_iterations: int = 5) -> dict:
    sizes = select_samples(ws, sample_size)
    log = []
    refuted: dict[str, dict] = {}
    features: list[dict] = []
    converged = False
    for it in range(1, max_iterations + 1):
        features = extract_features(ws)
        ces = evaluate_features(ws, features)
        entry = {
            "iteration": it,
            "sample_sizes": {t: ws.row_count(sample_name(t)) for t in ws.table_names},
            "features": len(features),
            "counterexamples": [
                {"feature": fid, "count": ce["count"], "added_rows": len(ce["rowids"]), "rows": ce["rows"]}
                for fid, ce in ces.items()
            ],
        }
        log.append(entry)
        if not ces:
            converged = True
            break
        for fid, ce in ces.items():
            refuted[fid] = {"feature": ce["feature"], "count": ce["count"], "iteration": it}
        entry["added"] = expand_samples(ws, ces)
        features = [f for f in features if f["id"] not in ces]
    verified = [dict(f, status="verified") for f in features]
    return {
        "initial_sample_sizes": sizes,
        "sample_sizes": {t: ws.row_count(sample_name(t)) for t in ws.table_names},
        "iterations": len(log),
        "converged": converged,
        "max_iterations": max_iterations,
        "detected_features": verified,
        "refuted_features": list(refuted.values()),
        "log": log,
    }


def sample_rows(ws: Workspace, table: str, limit: int = 50) -> list[dict]:
    return ws.rows(f"SELECT * FROM {q(sample_name(table))} ORDER BY __rid", limit)


