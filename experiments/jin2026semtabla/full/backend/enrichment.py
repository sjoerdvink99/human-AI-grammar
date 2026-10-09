"""Process 2 — Semantic Enrichment and Table Profiling: four stages run by the user.

stage "attributes":   [tool_1 extract] column_attributes -> [tool_1 assign] rule_taxonomies
                      -> [model_1 assign] predicted_taxonomies -> [tool_1 compose] column_semantics
stage "keys":         [tool_1 extract] key_relations
stage "dependencies": [tool_1 extract] functional_dependencies
stage "tables":       [tool_1 assign] table_labels -> [model_2 assign] table_types
                      -> [tool_1 compose] semantic_profile
"""
from __future__ import annotations

import re

from .detection import _family, _stem
from .patterns import PATTERNS, match_expr
from .store import Workspace, q
from .table_classifier import TableClassifier, assign_table_labels
from .taxonomy import TAXONOMY, assign_rule_taxonomies, predict_taxonomies

STAGES = ["attributes", "keys", "dependencies", "tables"]


def col_key(table: str, column: str) -> str:
    return f"{table}.{column}"


# --------------------------------------------------------------------------- [tool_1 extract] column_attributes
def extract_column_attributes(ws: Workspace, detected_features: list[dict]) -> list[dict]:
    by_col: dict[str, list[dict]] = {}
    for f in detected_features:
        for c in f["columns"]:
            by_col.setdefault(col_key(f["table"], c), []).append(f)
    out = []
    for t in ws.table_names:
        n = ws.row_count(t)
        for c, typ in ws.columns(t):
            qc, qt = q(c), q(t)
            fam = _family(typ)
            nonnull, distinct = ws.con.execute(f"SELECT count({qc}), count(DISTINCT {qc}) FROM {qt}").fetchone()
            a = {
                "key": col_key(t, c), "table": t, "column": c, "type": typ, "family": fam,
                "rows": n, "non_null": nonnull, "distinct": distinct,
                "null_ratio": round(1 - nonnull / n, 4) if n else 0,
                "uniqueness": round(distinct / nonnull, 4) if nonnull else 0,
            }
            # best value pattern on the full data
            best, best_ratio = None, 0.0
            if nonnull:
                for pname, _ in PATTERNS:
                    m = ws.scalar(f"SELECT count(*) FROM {qt} WHERE {qc} IS NOT NULL AND {match_expr(c, pname)}")
                    r = m / nonnull
                    if r > best_ratio + 1e-9:
                        best, best_ratio = pname, r
                    if r == 1.0:
                        break
            a["pattern"], a["pattern_ratio"] = best, round(best_ratio, 4)
            if fam in ("int", "float"):
                mn, mx, avg = ws.con.execute(f"SELECT min({qc}), max({qc}), avg({qc}) FROM {qt}").fetchone()
                a.update(min=mn, max=mx, mean=round(avg, 4) if avg is not None else None)
                if fam == "int" and nonnull and distinct == nonnull and mn is not None:
                    a["is_sequential"] = (mx - mn + 1) <= nonnull * 1.5
            elif fam == "time":
                mn, mx = ws.con.execute(f"SELECT min({qc}), max({qc}) FROM {qt}").fetchone()
                a.update(min=str(mn), max=str(mx))
            else:
                a["avg_length"] = ws.scalar(f"SELECT round(avg(length(CAST({qc} AS VARCHAR))), 2) FROM {qt}")
            a["top_values"] = ws.rows(
                f"SELECT CAST({qc} AS VARCHAR) AS value, count(*) AS count FROM {qt} WHERE {qc} IS NOT NULL "
                f"GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5")
            a["sample_values"] = [r["v"] for r in ws.rows(
                f"SELECT DISTINCT CAST({qc} AS VARCHAR) AS v FROM {qt} WHERE {qc} IS NOT NULL ORDER BY hash(v) LIMIT 8")]
            feats = by_col.get(a["key"], [])
            a["verified_unique"] = any(f["kind"] == "unique" and f["columns"] == [c] for f in feats)
            a["verified_not_null"] = any(f["kind"] == "not_null" for f in feats)
            vp = [f["pattern"] for f in feats if f["kind"] == "pattern"]
            a["verified_pattern"] = vp[0] if vp else None
            out.append(a)
    return out


# --------------------------------------------------------------------------- [tool_1 compose] column_semantics
def compose_column_semantics(column_attributes, rule_taxonomies, predicted_taxonomies) -> list[dict]:
    out = []
    for a in column_attributes:
        r = rule_taxonomies[a["key"]]
        if r["category"] != "ambiguous":
            sem = {"category": r["category"], "source": "rule", "confidence": 1.0, "rationale": r["reason"]}
        else:
            p = predicted_taxonomies.get(a["key"], {"category": "other", "confidence": 0, "rationale": "not predicted"})
            sem = {"category": p["category"], "source": "model", "confidence": p["confidence"],
                   "rationale": p["rationale"], "model_error": p.get("error", False)}
        out.append({**a, **sem})
    return out


# --------------------------------------------------------------------------- [tool_1 extract] key_relations
def extract_key_relations(ws: Workspace, detected_features: list[dict], column_semantics: list[dict]) -> dict:
    not_null = {(f["table"], f["columns"][0]) for f in detected_features if f["kind"] == "not_null"}
    cat = {(c["table"], c["column"]): c["category"] for c in column_semantics}
    order = {t: [c for c, _ in ws.columns(t)] for t in ws.table_names}
    candidates: dict[str, list[list[str]]] = {}
    for f in detected_features:
        if f["kind"] == "unique" and all((f["table"], c) in not_null for c in f["columns"]):
            candidates.setdefault(f["table"], []).append(f["columns"])
    pks: dict[str, list[str]] = {}
    for t in ws.table_names:
        cands = candidates.get(t, [])
        if not cands:
            continue
        stem = _stem(t)

        def score(cols):
            s = len(cols) * 10
            for c in cols:
                lc = c.lower()
                if lc in ("id", f"{stem}_id", f"{stem}id", f"{stem}_code", f"{stem}_key"):
                    s -= 6
                elif re.search(r"(_id|_code|_key|_no)$", lc):
                    s -= 3
                if cat.get((t, c)) == "identifier":
                    s -= 2
                if _family(dict(ws.columns(t)).get(c, "")) == "int":
                    s -= 1
                s += order[t].index(c) * 0.1
            return s

        pks[t] = sorted(cands, key=score)[0]
    fks = []
    for f in detected_features:
        if f["kind"] != "inclusion":
            continue
        ref_pk = pks.get(f["ref_table"])
        if ref_pk == f["ref_columns"] or (f["ref_columns"] in candidates.get(f["ref_table"], [])):
            fks.append({"from_table": f["table"], "from_column": f["columns"][0],
                        "to_table": f["ref_table"], "to_column": f["ref_columns"][0], "source": "detected"})
    return {
        "primary_keys": pks,
        "candidate_keys": candidates,
        "foreign_keys": fks,
        "nodes": [{"id": t} for t in ws.table_names],
        "links": [{"source": f["from_table"], "target": f["to_table"], **f} for f in fks],
    }


# --------------------------------------------------------------------------- [tool_1 extract] functional_dependencies
def extract_functional_dependencies(detected_features: list[dict], key_relations: dict) -> list[dict]:
    pks = key_relations["primary_keys"]
    cands = key_relations["candidate_keys"]
    out = []
    for f in detected_features:
        if f["kind"] != "fd":
            continue
        t, lhs, rhs = f["table"], f["columns"][0], f["rhs"]
        if [lhs] in cands.get(t, []) or rhs in (pks.get(t) or []):
            continue  # trivial: lhs is a key, or rhs is part of the key
        out.append({"table": t, "lhs": lhs, "rhs": rhs, "source": "detected"})
    return out


# --------------------------------------------------------------------------- [tool_1 compose] semantic_profile
def compose_profile(ws: Workspace, column_semantics, key_relations, functional_dependencies,
                    table_labels, table_types) -> dict:
    tables = []
    for t in ws.table_names:
        tt = table_types.get(t, {})
        tables.append({
            "name": t,
            "rows": ws.row_count(t),
            "primary_key": key_relations["primary_keys"].get(t, []),
            "candidate_keys": key_relations["candidate_keys"].get(t, []),
            "labels": table_labels.get(t, []),
            "type": tt.get("type"),
            "type_confidence": tt.get("confidence"),
            "type_source": tt.get("source", "model_2"),
            "type_path": tt.get("path", []),
        })
    return {
        "tables": tables,
        "columns": column_semantics,
        "foreign_keys": key_relations["foreign_keys"],
        "functional_dependencies": functional_dependencies,
        "taxonomy": list(TAXONOMY),
    }


def tables_summary(ws: Workspace) -> list[dict]:
    return [{"name": t, "rows": ws.row_count(t)} for t in ws.table_names]


def classify_tables(classifier: TableClassifier, labels: dict, overrides: dict) -> dict:
    types = classifier.predict(labels)
    for t, v in types.items():
        v["source"] = "model_2"
        if t in overrides:
            v.update(type=overrides[t], source="user", confidence=1.0)
    return types


def run_stage(ws: Workspace, stage: str, classifier: TableClassifier) -> dict:
    if ws.detection is None:
        raise ValueError("run semantic detection (process 1) first")
    feats = ws.detection["detected_features"]
    idx = STAGES.index(stage)
    missing = [s for s in STAGES[:idx] if s not in ws.stages_done]
    if missing:
        raise ValueError(f"run stage(s) {', '.join(missing)} first")
    if stage == "attributes":
        ws.column_attributes = extract_column_attributes(ws, feats)
        ws.rule_taxonomies = assign_rule_taxonomies(ws.column_attributes)
        ws.predicted_taxonomies = predict_taxonomies(ws.column_attributes, ws.rule_taxonomies)
        ws.column_semantics = compose_column_semantics(ws.column_attributes, ws.rule_taxonomies, ws.predicted_taxonomies)
    elif stage == "keys":
        ws.key_relations = extract_key_relations(ws, feats, ws.column_semantics)
    elif stage == "dependencies":
        ws.functional_dependencies = extract_functional_dependencies(feats, ws.key_relations)
    elif stage == "tables":
        ws.table_labels = assign_table_labels(tables_summary(ws), ws.column_semantics, ws.key_relations,
                                              ws.functional_dependencies)
        ws.table_types = classify_tables(classifier, ws.table_labels, ws.type_overrides)
        ws.push_profile(compose_profile(ws, ws.column_semantics, ws.key_relations, ws.functional_dependencies,
                                        ws.table_labels, ws.table_types))
    ws.stages_done = STAGES[: idx + 1]
    return stage_result(ws, stage)


def stage_result(ws: Workspace, stage: str) -> dict:
    if stage == "attributes":
        return {"column_semantics": ws.column_semantics, "rule_taxonomies": ws.rule_taxonomies,
                "predicted_taxonomies": ws.predicted_taxonomies}
    if stage == "keys":
        return {"key_relations": ws.key_relations}
    if stage == "dependencies":
        return {"functional_dependencies": ws.functional_dependencies}
    return {"table_labels": ws.table_labels, "table_types": ws.table_types, "semantic_profile": ws.profile}
