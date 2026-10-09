"""Process 2 — from profiles to a data model (and the tool steps of process 4).

(r1)* + (r3)* -> [tool extract] r5 -> [tool assign] r6 -> [model_1 assign] r7
-> [tool compose] r8 -> [tool extract] r9 -> [tool extract] r10
-> [tool assign] r11 -> [model_2 assign] r12 -> [tool compose] r13
(-> [tool_2 translate] r14 happens in the browser: frontend/render.js)
"""
from __future__ import annotations

import json
import re

import pandas as pd

from .classifier import KEY_ROLES, KeyClassifier
from .model_provider import ModelError, call_model_json

DATA_TYPES = ["integer", "float", "text", "date", "boolean"]
SEMANTIC_TYPES = ["identifier", "code", "name", "category", "measure", "timestamp", "free_text", "other"]
ID_TOKENS = re.compile(r"(^id$|_id$|^id_|id$|_key$|^key$|_code$|^code$|^sku$|_no$|_nr$|_number$|uuid)", re.I)
MIN_COVERAGE = 0.95


def _stem(name: str) -> str:
    n = name.lower()
    if n.endswith("ies"):
        return n[:-3] + "y"
    if n.endswith("s"):
        return n[:-1]
    return n


def _name_link(src_col: str, tgt_table: str, tgt_col: str) -> bool:
    """Do the names suggest src refers to tgt? (same name, or src mentions the target table)."""
    s = src_col.lower()
    return s == tgt_col.lower() or (_stem(tgt_table) in s and bool(ID_TOKENS.search(s)))


# ---------------------------------------------------------------- r5
def extract_features(tables: dict[str, pd.DataFrame], profiles: list[dict]) -> list[dict]:
    """[tool extract] r1 + r3 -> r5: per-column feature records (uniqueness on the full table)."""
    feats = []
    for p in profiles:
        s = tables[p["table"]][p["column"]]
        non_null = s.dropna()
        is_unique = bool(len(non_null) == len(s) and non_null.is_unique and len(s) > 0)
        feats.append({
            "id": p["id"], "table": p["table"], "column": p["column"], "position": p["position"],
            "dtype": p["dtype"], "examples": p["examples"],
            "is_integer": int(p["dtype"] == "int"),
            "is_text": int(p["dtype"] == "str"),
            "distinct_ratio": p["distinct_ratio"],
            "null_ratio": p["null_ratio"],
            "is_unique": int(is_unique),
            "name_id_like": int(bool(ID_TOKENS.search(p["column"]))),
            "name_matches_table": int(_stem(p["table"]) in p["column"].lower()),
            "is_first_column": int(p["position"] == 0),
        })
    return feats


# ---------------------------------------------------------------- r6
def assign_data_types(tables: dict[str, pd.DataFrame], features: list[dict]) -> dict[str, str]:
    """[tool assign] r5 -> r6: primitive data type per column."""
    out = {}
    for f in features:
        s = tables[f["table"]][f["column"]].dropna()
        if f["dtype"] == "bool" or (len(s) and set(s.astype(str).str.lower().unique()) <= {"true", "false", "0", "1", "yes", "no"} and s.nunique() <= 2 and f["dtype"] == "str"):
            out[f["id"]] = "boolean"
        elif f["dtype"] == "int":
            out[f["id"]] = "integer"
        elif f["dtype"] == "float":
            out[f["id"]] = "float"
        else:
            sample = s.astype(str).head(50)
            parsed = pd.to_datetime(sample, errors="coerce", format="mixed") if len(sample) else sample
            looks_date = len(sample) and sample.str.contains(r"\d{1,4}[-/.]\d{1,2}", regex=True).mean() > 0.8
            out[f["id"]] = "date" if looks_date and parsed.notna().mean() > 0.9 else "text"
    return out


# ---------------------------------------------------------------- r7
SEMANTIC_PROMPT = """You label the semantic type of database columns.
Allowed labels: {labels}.
Definitions: identifier = a surrogate/natural key or a reference to one; code = short codes such as SKUs, ISO codes, zip codes;
name = names or titles of things or people; category = a small set of repeated values; measure = a quantity, price, count or amount;
timestamp = dates or times; free_text = long descriptive text; other = anything else.

Columns (JSON, one per line):
{columns}

Reply with ONLY a JSON object mapping each column id to exactly one allowed label. No commentary."""


def _fallback_semantic(f: dict, dtype: str) -> str:
    if dtype == "date":
        return "timestamp"
    if f["name_id_like"]:
        return "code" if f["is_text"] else "identifier"
    if dtype in ("integer", "float"):
        return "measure"
    if f["distinct_ratio"] < 0.2:
        return "category"
    return "free_text" if f.get("avg_length", 0) > 60 else "name"


def assign_semantic_types(features: list[dict], data_types: dict[str, str]) -> tuple[dict[str, str], dict]:
    """[model_1 assign] r5 + r6 -> r7: semantic type per column, validated against SEMANTIC_TYPES."""
    lines = [json.dumps({"id": f["id"], "data_type": data_types[f["id"]], "distinct_ratio": f["distinct_ratio"],
                         "examples": f["examples"][:4]}) for f in features]
    prompt = SEMANTIC_PROMPT.format(labels=", ".join(SEMANTIC_TYPES), columns="\n".join(lines))
    meta = {"provider": "claude-cli", "fallback_used": [], "error": None}
    reply = {}
    try:
        reply = call_model_json(prompt)
        if not isinstance(reply, dict):
            raise ModelError("reply is not an object")
    except ModelError as e:
        meta["error"] = str(e)
        reply = {}
    out = {}
    for f in features:
        label = str(reply.get(f["id"], "")).strip().lower()
        if label not in SEMANTIC_TYPES:  # enforce the label set where r7 is produced
            label = _fallback_semantic(f, data_types[f["id"]])
            meta["fallback_used"].append(f["id"])
        out[f["id"]] = label
    return out, meta


# ---------------------------------------------------------------- r8
def compose_columns(features: list[dict], data_types: dict[str, str], semantic: dict[str, str]) -> list[dict]:
    """[tool compose] r5 + r6 + r7 -> r8: one annotated record per column."""
    cols = []
    for f in features:
        sem = semantic[f["id"]]
        c = dict(f)
        c["data_type"] = data_types[f["id"]]
        c["semantic_type"] = sem
        for s in ("identifier", "code", "measure", "name"):
            c[f"sem_{s}"] = int(sem == s)
        cols.append(c)
    return cols


# ---------------------------------------------------------------- r9, r10
def extract_inclusion_graph(tables: dict[str, pd.DataFrame], columns: list[dict]) -> dict:
    """[tool extract] r1 + r8 -> r9: column -> column inclusion dependencies.

    Edge A -> B when B is unique in its table and at least MIN_COVERAGE of
    A's distinct values occur in B.
    """
    values = {c["id"]: set(tables[c["table"]][c["column"]].dropna().astype(str).unique()) for c in columns}
    targets = [c for c in columns if c["is_unique"] and c["data_type"] in ("integer", "text")]
    links = []
    for a in columns:
        va = values[a["id"]]
        if len(va) < 2 or a["data_type"] not in ("integer", "text"):
            continue
        for b in targets:
            if b["table"] == a["table"] or b["data_type"] != a["data_type"]:
                continue
            cov = len(va & values[b["id"]]) / len(va)
            if cov >= MIN_COVERAGE:
                links.append({"source": a["id"], "target": b["id"], "coverage": round(cov, 3),
                              "name_link": _name_link(a["column"], b["table"], b["column"])})
    nodes = [{"id": c["id"], "table": c["table"]} for c in columns]
    return {"nodes": nodes, "links": links}


def extract_table_graph(columns: list[dict], inclusion: dict) -> dict:
    """[tool extract] r9 -> r10: table -> table graph collapsed from column links."""
    tables = sorted({c["table"] for c in columns})
    agg: dict[tuple, dict] = {}
    for l in inclusion["links"]:
        s, t = l["source"].split(".", 1)[0], l["target"].split(".", 1)[0]
        e = agg.setdefault((s, t), {"source": s, "target": t, "via": [], "named": 0})
        e["via"].append(f'{l["source"]}→{l["target"]}')
        e["named"] += int(l["name_link"])
    return {"nodes": [{"id": t} for t in tables], "links": list(agg.values())}


def add_degree_features(columns: list[dict], links: list[dict]) -> list[dict]:
    """Graph features used by model_2: name-supported in/out degree of each column."""
    named = [l for l in links if l.get("name_link", True)]
    for c in columns:
        c["out_degree"] = sum(1 for l in named if l["source"] == c["id"])
        c["in_degree"] = sum(1 for l in named if l["target"] == c["id"])
    return columns


# ---------------------------------------------------------------- r11
def assign_rule_keys(columns: list[dict], inclusion: dict, table_graph: dict) -> dict[str, str]:
    """[tool assign] r8 + r9 + r10 -> r11: rule-based key role per column."""
    labels = {c["id"]: "attribute" for c in columns}
    by_table: dict[str, list[dict]] = {}
    for c in columns:
        by_table.setdefault(c["table"], []).append(c)
    for t, cols in by_table.items():
        cands = [c for c in cols if c["is_unique"] and c["data_type"] in ("integer", "text")
                 and (c["name_id_like"] or c["is_first_column"])]
        if cands:
            best = max(cands, key=lambda c: (c["name_matches_table"], c["in_degree"], c["name_id_like"], -c["position"]))
            labels[best["id"]] = "primary_key"
    for c in columns:
        if labels[c["id"]] != "primary_key" and c["out_degree"] > 0:
            labels[c["id"]] = "foreign_key"
    return labels


# ---------------------------------------------------------------- r13
def _cardinality(src: dict) -> str:
    return "1:1" if src.get("is_unique") else "N:1"


def compose_data_model(columns: list[dict], inclusion: dict, table_graph: dict,
                       rule_keys: dict[str, str], model_keys: dict[str, dict]) -> dict:
    """[tool compose] r8 + r9 + r10 + r11 + r12 -> r13: the data model (entities + relationships)."""
    by_id = {c["id"]: c for c in columns}
    role = {cid: model_keys[cid]["label"] for cid in model_keys}
    entities = []
    for t in [n["id"] for n in table_graph["nodes"]]:
        cols = [c for c in columns if c["table"] == t]
        pk_cands = [c for c in cols if role[c["id"]] == "primary_key"]
        pk = max(pk_cands, key=lambda c: (model_keys[c["id"]]["confidence"], rule_keys[c["id"]] == "primary_key")) if pk_cands else None
        entities.append({
            "name": t, "label": t, "primary_key": pk["column"] if pk else None,
            "columns": [_entity_column(c, rule_keys, model_keys) for c in cols],
        })
    pk_of = {e["name"]: e["primary_key"] for e in entities}
    rels, seen = [], set()
    ranked = sorted(inclusion["links"], key=lambda l: (-int(l["name_link"]), -l["coverage"]))
    for l in ranked:
        src, tgt = by_id[l["source"]], by_id[l["target"]]
        if role[src["id"]] != "foreign_key" or pk_of.get(tgt["table"]) != tgt["column"] or src["id"] in seen:
            continue
        seen.add(src["id"])
        rels.append({
            "id": f'{src["id"]}->{tgt["id"]}',
            "from_table": src["table"], "from_column": src["column"],
            "to_table": tgt["table"], "to_column": tgt["column"],
            "cardinality": _cardinality(src), "coverage": l["coverage"],
        })
    return {"version": 1, "entities": entities, "relationships": rels}


def _entity_column(c: dict, rule_keys: dict, model_keys: dict) -> dict:
    keep = ["is_integer", "is_text", "distinct_ratio", "null_ratio", "is_unique", "name_id_like",
            "name_matches_table", "is_first_column", "sem_identifier", "sem_code", "sem_measure", "sem_name",
            "in_degree", "out_degree", "position"]
    return {
        "name": c["column"], "data_type": c["data_type"], "semantic_type": c["semantic_type"],
        "role": model_keys[c["id"]]["label"], "confidence": model_keys[c["id"]]["confidence"],
        "rule_role": rule_keys[c["id"]], "features": {k: c[k] for k in keep},
    }


# ---------------------------------------------------------------- process 4 helpers
def validate_data_model(dm: dict, original: dict) -> dict:
    """Check a human-edited data model (r13_2) refers only to existing tables and columns."""
    known = {e["name"]: {c["name"] for c in e["columns"]} for e in original["entities"]}
    if {e["name"] for e in dm["entities"]} != set(known):
        raise ValueError("entities cannot be added or removed; edit labels, keys and relationships")
    for e in dm["entities"]:
        if e.get("primary_key") not in (None, "") and e["primary_key"] not in known[e["name"]]:
            raise ValueError(f'unknown primary key {e["primary_key"]} in {e["name"]}')
    for r in dm["relationships"]:
        for side in ("from", "to"):
            t, c = r[f"{side}_table"], r[f"{side}_column"]
            if t not in known or c not in known[t]:
                raise ValueError(f"relationship refers to unknown column {t}.{c}")
        if r["from_table"] == r["to_table"] and r["from_column"] == r["to_column"]:
            raise ValueError("a relationship cannot point to itself")
    return dm


def model_columns(dm: dict) -> list[dict]:
    """Flatten r13_2 into classifier inputs, with degrees recomputed from its relationships."""
    cols = []
    for e in dm["entities"]:
        for c in e["columns"]:
            rec = dict(c["features"])
            rec.update({"id": f'{e["name"]}.{c["name"]}', "table": e["name"], "column": c["name"]})
            cols.append(rec)
    links = [{"source": f'{r["from_table"]}.{r["from_column"]}', "target": f'{r["to_table"]}.{r["to_column"]}'}
             for r in dm["relationships"]]
    return add_degree_features(cols, links)


def assign_rule_keys_for_model(dm: dict) -> tuple[dict[str, str], dict[str, str]]:
    """[tool assign] r13_2 -> r19: key roles and relationship cardinalities implied by the edited model."""
    roles = {}
    fks = {f'{r["from_table"]}.{r["from_column"]}' for r in dm["relationships"]}
    for e in dm["entities"]:
        for c in e["columns"]:
            cid = f'{e["name"]}.{c["name"]}'
            roles[cid] = "primary_key" if c["name"] == e.get("primary_key") else ("foreign_key" if cid in fks else "attribute")
    feats = {f'{e["name"]}.{c["name"]}': c["features"] for e in dm["entities"] for c in e["columns"]}
    card = {r["id"]: _cardinality(feats[f'{r["from_table"]}.{r["from_column"]}']) for r in dm["relationships"]}
    return roles, card


def apply_labels_to_model(dm: dict, rule_roles: dict, model_roles: dict, card: dict) -> dict:
    """Write r19/r20 back onto the edited model so the diagram (r21) can show them."""
    for e in dm["entities"]:
        for c in e["columns"]:
            cid = f'{e["name"]}.{c["name"]}'
            c["role"] = rule_roles[cid]
            c["rule_role"] = rule_roles[cid]
            c["model_role"] = model_roles[cid]["label"]
            c["confidence"] = model_roles[cid]["confidence"]
    for r in dm["relationships"]:
        r["cardinality"] = card[r["id"]]
    return dm


__all__ = ["KEY_ROLES", "KeyClassifier"]
