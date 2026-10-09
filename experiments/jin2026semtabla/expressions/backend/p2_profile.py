"""Process 2 — build the semantic profile from the tables and the detected features."""
import json
import re
import time

from features import is_numeric_dtype
from llm import call_model
from store import Store, qi
from taxonomy import (SEMANTIC_TYPES, SEMANTIC_TYPE_HELP, TABLE_TYPES, TABLE_TYPE_HELP)

NUMERIC_MEASURES = {"currency_amount", "quantity", "percentage", "measure", "latitude", "longitude"}
CATEGORICAL = {"category", "status", "boolean", "country_code", "currency_code", "code", "city", "country"}
TEXTUAL = {"person_name", "entity_name", "description", "address", "email", "url", "phone"}
TEMPORAL = {"date", "datetime", "year"}
KEYLIKE = {"identifier", "code", "country_code", "currency_code", "postal_code"}


# ---------------------------------------------------------------- column attributes
def extract_column_attributes(store: Store, tables, detected_features):
    """[tool_1 extract] tables_1* + detected_features_1* -> column_attributes_1*"""
    feats_by_col = {}
    for f in detected_features:
        if f.get("status") == "holds":
            feats_by_col.setdefault((f["table"], f["column"]), []).append(
                {"kind": f["kind"], "params": f["params"], "description": f["description"]})
    attrs = []
    for t in tables:
        meta = store.tables[t]
        for col in meta["columns"]:
            c, s = qi(col["name"]), f'CAST({qi(col["name"])} AS VARCHAR)'
            num = is_numeric_dtype(col["dtype"])
            _, [row] = store.query(
                f"SELECT COUNT(*) AS n, COUNT({c}) AS non_null, COUNT(DISTINCT {c}) AS n_distinct, "
                f"MIN({c}) AS min, MAX({c}) AS max, AVG(length({s})) AS avg_len"
                + (f", AVG({c}) AS mean" if num else "") + f" FROM {qi(t)}")
            _, top = store.query(f"SELECT {s} AS value, COUNT(*) AS count FROM {qi(t)} WHERE {c} IS NOT NULL "
                                 f"GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5")
            _, sample = store.query(f"SELECT v FROM (SELECT DISTINCT {s} AS v FROM {qi(t)} WHERE {c} IS NOT NULL) "
                                    f"ORDER BY hash(v) LIMIT 8")
            features = feats_by_col.get((t, col["name"]), [])
            vtype = next((f["params"]["type"] for f in features if f["kind"] == "type"), None)
            attrs.append({
                "table": t, "column": col["name"], "dtype": col["dtype"], "value_type": vtype,
                "count": row["n"], "nulls": row["n"] - row["non_null"], "distinct": row["n_distinct"],
                "distinct_ratio": round(row["n_distinct"] / row["non_null"], 3) if row["non_null"] else 0,
                "min": row["min"], "max": row["max"],
                "avg_len": round(row["avg_len"], 1) if row["avg_len"] is not None else None,
                "mean": round(row["mean"], 3) if num and row.get("mean") is not None else None,
                "top_values": top, "sample_values": [r["v"] for r in sample], "features": features,
            })
    return attrs


# ---------------------------------------------------------------- rule taxonomy
def _rule_type(a):
    name = a["column"].lower()
    feats = {f["kind"]: f["params"] for f in a["features"]}
    pattern = feats.get("pattern", {}).get("name")
    vt = a["value_type"] or ""
    words = set(re.split(r"[_\W]+", name))

    def has(*keys):
        return any(k in words or name.endswith(k) for k in keys)

    if pattern == "email" or has("email", "mail"):
        return ("email", "pattern:email" if pattern == "email" else "name:email", "strong" if pattern else "weak")
    if pattern == "url" or has("url", "website", "link"):
        return ("url", "pattern:url" if pattern else "name:url", "strong" if pattern else "weak")
    if pattern == "uuid":
        return ("identifier", "pattern:uuid", "strong")
    if vt == "boolean" or (feats.get("domain") and len(feats["domain"]["values"]) == 2 and
                           {v.lower() for v in feats["domain"]["values"]} in
                           ({"0", "1"}, {"y", "n"}, {"yes", "no"}, {"true", "false"})):
        return ("boolean", "type:boolean", "strong")
    if vt == "datetime":
        return ("datetime", "type:datetime", "strong")
    if vt == "date" or pattern == "iso_date":
        return ("date", "type:date", "strong")
    if has("lat", "latitude"):
        return ("latitude", "name:latitude", "weak")
    if has("lon", "lng", "longitude"):
        return ("longitude", "name:longitude", "weak")
    if has("year") and vt == "integer":
        return ("year", "name+type:year", "weak")
    if has("country") and pattern == "upper_code2":
        return ("country_code", "name+pattern:country_code", "strong")
    if has("currency") and pattern == "upper_code3":
        return ("currency_code", "name+pattern:currency_code", "strong")
    if has("id", "key", "uuid") and vt in ("integer", "text"):
        return ("identifier", "name:id", "weak")
    if "unique" in feats and "not_null" in feats and vt == "integer":
        return ("identifier", "unique+not_null integer", "weak")
    if has("zip", "postal", "postcode"):
        return ("postal_code", "name:postal", "weak")
    if has("phone", "tel", "mobile"):
        return ("phone", "name:phone", "weak")
    if has("address", "street"):
        return ("address", "name:address", "weak")
    if has("city", "town"):
        return ("city", "name:city", "weak")
    if has("country"):
        return ("country", "name:country", "weak")
    if has("price", "amount", "cost", "revenue", "total", "salary", "fee") and vt in ("integer", "decimal"):
        return ("currency_amount", "name:money", "weak")
    if has("qty", "quantity", "count", "num") and vt == "integer":
        return ("quantity", "name:quantity", "weak")
    if has("pct", "percent", "percentage", "rate", "ratio") and vt in ("integer", "decimal"):
        return ("percentage", "name:percentage", "weak")
    if has("status", "state"):
        return ("status", "name:status", "weak")
    if has("sku", "code") or pattern == "alnum_code":
        return ("code", "name/pattern:code", "weak")
    if has("name", "title"):
        if has("first", "last", "full", "customer", "employee", "contact", "person", "user"):
            return ("person_name", "name:person", "weak")
        return ("entity_name", "name:name", "weak")
    if "domain" in feats:
        return ("category", "feature:domain", "weak")
    if vt == "text" and (a["avg_len"] or 0) > 30:
        return ("description", "avg_len>30", "weak")
    if vt in ("integer", "decimal"):
        return ("measure", "type:numeric", "weak")
    if vt == "text" and a["distinct_ratio"] < 0.1:
        return ("category", "low distinct ratio", "weak")
    return ("unknown", "no rule", "weak")


def assign_rule_taxonomies(column_attributes):
    """[tool_1 assign] column_attributes_1* -> rule_taxonomies_1*"""
    out = []
    for a in column_attributes:
        label, rule, strength = _rule_type(a)
        out.append({"table": a["table"], "column": a["column"], "semantic_type": label,
                    "rule": rule, "strength": strength})
    return out


# ---------------------------------------------------------------- model_1
MODEL1_SYSTEM = ("You are model_1, a column semantic-type annotator inside a data profiling tool. "
                 "Answer only with the requested JSON.")


def _model1_prompt(attrs, rules):
    lines = []
    for a, r in zip(attrs, rules):
        lines.append(json.dumps({
            "table": a["table"], "column": a["column"], "dtype": a["dtype"], "value_type": a["value_type"],
            "rows": a["count"], "nulls": a["nulls"], "distinct": a["distinct"],
            "min": a["min"], "max": a["max"], "sample_values": a["sample_values"][:8],
            "validated_features": [f["description"] for f in a["features"]],
            "rule_label": r["semantic_type"], "rule": r["rule"],
        }, default=str))
    taxonomy = "\n".join(f"- {t}: {SEMANTIC_TYPE_HELP[t]}" for t in SEMANTIC_TYPES)
    return (
        "Assign a semantic type to every column below. Choose exactly one type per column from this "
        f"fixed taxonomy:\n{taxonomy}\n\n"
        "Each column is given with its statistics, sample values, features that were validated on the full "
        "table, and the label a rule-based annotator assigned (rule_label). Agree with the rule when it is "
        "right, override it when the evidence says otherwise. Use the table name as context.\n\n"
        "Columns (one JSON object per line):\n" + "\n".join(lines) +
        "\n\nReturn {\"predictions\": [...]} with one entry per column, in the same order, each with "
        "table, column, semantic_type, confidence (0-1) and a one-sentence rationale.")


MODEL1_SCHEMA = {
    "type": "object",
    "properties": {"predictions": {"type": "array", "items": {
        "type": "object",
        "properties": {"table": {"type": "string"}, "column": {"type": "string"},
                       "semantic_type": {"type": "string", "enum": SEMANTIC_TYPES},
                       "confidence": {"type": "number"}, "rationale": {"type": "string"}},
        "required": ["table", "column", "semantic_type", "confidence", "rationale"]}}},
    "required": ["predictions"],
}


def model1_assign_taxonomies(column_attributes, rule_taxonomies, chunk=40):
    """[model_1 assign]~ tables_1* + column_attributes_1* + rule_taxonomies_1* -> predicted_taxonomies_1*"""
    preds = {}
    for i in range(0, len(column_attributes), chunk):
        attrs, rules = column_attributes[i:i + chunk], rule_taxonomies[i:i + chunk]
        out = call_model(_model1_prompt(attrs, rules), MODEL1_SCHEMA, MODEL1_SYSTEM)
        for p in out.get("predictions", []):
            preds[(p.get("table"), p.get("column"))] = p
    result = []
    for a in column_attributes:  # validate: one label per column, from the taxonomy
        p = preds.get((a["table"], a["column"]))
        if not p:
            result.append({"table": a["table"], "column": a["column"], "semantic_type": "unknown",
                           "confidence": 0.0, "rationale": "model returned no prediction", "valid": False})
            continue
        st = p.get("semantic_type")
        valid = st in SEMANTIC_TYPES
        result.append({"table": a["table"], "column": a["column"],
                       "semantic_type": st if valid else "unknown",
                       "confidence": max(0.0, min(1.0, float(p.get("confidence") or 0))),
                       "rationale": str(p.get("rationale", ""))[:400], "valid": valid})
    return result


# ---------------------------------------------------------------- compose column semantics
def compose_column_semantics(column_attributes, rule_taxonomies, predicted_taxonomies):
    """[tool_1 compose] -> column_semantics_1*"""
    out = []
    for a, r, p in zip(column_attributes, rule_taxonomies, predicted_taxonomies):
        if r["semantic_type"] == p["semantic_type"]:
            final, source = r["semantic_type"], "agree"
        elif r["strength"] == "strong":
            final, source = r["semantic_type"], "rule"
        elif p["semantic_type"] != "unknown":
            final, source = p["semantic_type"], "model"
        else:
            final, source = r["semantic_type"], "rule"
        out.append({
            "table": a["table"], "column": a["column"], "dtype": a["dtype"], "value_type": a["value_type"],
            "semantic_type": final, "source": source,
            "rule_type": r["semantic_type"], "rule": r["rule"], "rule_strength": r["strength"],
            "model_type": p["semantic_type"], "model_confidence": p["confidence"], "model_rationale": p["rationale"],
            "count": a["count"], "nulls": a["nulls"], "distinct": a["distinct"], "distinct_ratio": a["distinct_ratio"],
            "sample_values": a["sample_values"], "features": a["features"],
        })
    return out


# ---------------------------------------------------------------- key relations
def _stem(table):
    return re.sub(r"(ies)$", "y", re.sub(r"(?<!s)s$", "", table.lower()))


def extract_key_relations(store: Store, tables, column_semantics):
    """[tool_1 extract] tables_1* + column_semantics_1* -> key_relations_1 (graph)"""
    by_table = {}
    for c in column_semantics:
        by_table.setdefault(c["table"], []).append(c)
    candidate_keys, primary_keys = {}, {}
    for t in tables:
        cands = [c for c in by_table.get(t, []) if c["count"] > 1 and c["nulls"] == 0
                 and c["distinct"] == c["count"] and c["value_type"] != "decimal"]
        candidate_keys[t] = [c["column"] for c in cands]

        def rank(c):
            n = c["column"].lower()
            return (0 if n in ("id", f"{_stem(t)}_id", f"{t}_id") else
                    1 if c["semantic_type"] == "identifier" else
                    2 if c["semantic_type"] in KEYLIKE else 3, n)
        primary_keys[t] = sorted(cands, key=rank)[0]["column"] if cands else None

    edges = []
    for t1 in tables:
        for a in by_table.get(t1, []):
            if a["column"] == primary_keys[t1] or a["value_type"] in ("decimal", None) or a["distinct"] < 2:
                continue
            for t2 in tables:
                b = primary_keys.get(t2)
                if t2 == t1 or not b:
                    continue
                bsem = next(c for c in by_table[t2] if c["column"] == b)
                if (a["value_type"] == "integer") != (bsem["value_type"] == "integer"):
                    continue
                name_hint = a["column"].lower() == b.lower() or _stem(t2) in a["column"].lower()
                # surrogate integer ids overlap by accident, so identifiers need a name hint;
                # typed codes (country_code, …) may link by matching semantic type alone
                same_code = a["semantic_type"] in KEYLIKE - {"identifier"} and a["semantic_type"] == bsem["semantic_type"]
                if not (name_hint or same_code):
                    continue
                orphans = store.scalar(
                    f"SELECT COUNT(*) FROM (SELECT DISTINCT CAST({qi(a['column'])} AS VARCHAR) v FROM {qi(t1)} "
                    f"WHERE {qi(a['column'])} IS NOT NULL) x WHERE x.v NOT IN "
                    f"(SELECT CAST({qi(b)} AS VARCHAR) FROM {qi(t2)})")
                ratio = orphans / a["distinct"]
                if ratio <= 0.01:
                    edges.append({"id": f"fk:{t1}.{a['column']}->{t2}.{b}", "kind": "foreign_key",
                                  "from_table": t1, "from_column": a["column"], "to_table": t2, "to_column": b,
                                  "orphan_values": orphans, "exact": orphans == 0, "source": "discovered"})
    nodes = [{"id": t, "kind": "table", "primary_key": primary_keys[t], "candidate_keys": candidate_keys[t]}
             for t in tables]
    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------- functional dependencies
def extract_functional_dependencies(store: Store, tables, column_semantics, key_relations):
    """[tool_1 extract] tables_1* + column_semantics_1* + key_relations_1 -> functional_dependencies_1 (graph)"""
    pk = {n["id"]: set(n["candidate_keys"]) for n in key_relations["nodes"]}
    edges = []
    for t in tables:
        cols = [c for c in column_semantics if c["table"] == t]
        rhs_cols = [c for c in cols if c["column"] not in pk[t] and c["distinct"] > 1]
        lhs_cols = [c for c in rhs_cols if c["distinct_ratio"] <= 0.9 and c["semantic_type"] not in
                    NUMERIC_MEASURES | {"description", "date", "datetime"}]
        pairs = [(x, y) for x in lhs_cols for y in rhs_cols if x is not y]
        if not pairs:
            continue

        def v(c):
            return f"COALESCE(CAST({qi(c['column'])} AS VARCHAR), '∅')"
        aggs = [f"COUNT(DISTINCT {v(x)}) AS x{i}" for i, x in enumerate(lhs_cols)]
        aggs += [f"COUNT(DISTINCT {v(x)} || '\x1f' || {v(y)}) AS p{j}" for j, (x, y) in enumerate(pairs)]
        _, [row] = store.query(f"SELECT {', '.join(aggs)} FROM {qi(t)}")
        for j, (x, y) in enumerate(pairs):
            nx = row[f"x{lhs_cols.index(x)}"]
            if row[f"p{j}"] == nx:
                edges.append({"id": f"fd:{t}.{x['column']}->{y['column']}", "kind": "fd", "table": t,
                              "lhs": x["column"], "rhs": y["column"], "lhs_distinct": nx, "source": "discovered"})
    return {"edges": edges}


# ---------------------------------------------------------------- table labels (rules) + model_2
def table_features(table, columns, key_edges, n_rows, has_pk):
    """Table-level features (evidence for table labels; inputs of the table classifier)."""
    n = len(columns) or 1
    types = [c["semantic_type"] for c in columns]
    return {
        "n_rows": n_rows, "n_columns": len(columns),
        "n_fk_out": sum(e["from_table"] == table for e in key_edges),
        "n_referenced_by": sum(e["to_table"] == table for e in key_edges),
        "has_primary_key": bool(has_pk),
        "frac_identifier": round(sum(t == "identifier" for t in types) / n, 2),
        "frac_numeric_measure": round(sum(t in NUMERIC_MEASURES for t in types) / n, 2),
        "frac_categorical": round(sum(t in CATEGORICAL for t in types) / n, 2),
        "frac_text": round(sum(t in TEXTUAL for t in types) / n, 2),
        "frac_temporal": round(sum(t in TEMPORAL for t in types) / n, 2),
    }


def assign_table_labels(column_semantics, key_relations, functional_dependencies, n_rows):
    """[tool_1 assign] -> table_labels_1* (rule-based table type with its evidence)"""
    labels = []
    for node in key_relations["nodes"]:
        t = node["id"]
        cols = [c for c in column_semantics if c["table"] == t]
        f = table_features(t, cols, key_relations["edges"], n_rows.get(t, 0), node["primary_key"])
        fk_cols = {e["from_column"] for e in key_relations["edges"] if e["from_table"] == t}
        types = [c["semantic_type"] for c in cols]
        n_fd = sum(e["table"] == t for e in functional_dependencies["edges"])
        if f["n_fk_out"] >= 2 and len(cols) - len(fk_cols) - (1 if node["primary_key"] else 0) <= 1:
            label, rule = "bridge", "≥2 foreign keys and almost no other columns"
        elif f["n_fk_out"] >= 2 and f["frac_numeric_measure"] > 0:
            label, rule = "fact", "≥2 foreign keys and numeric measures"
        elif f["n_fk_out"] >= 1 and f["frac_temporal"] > 0 and "status" in types and f["n_referenced_by"] == 0:
            label, rule = "event_log", "references an entity, has time and status, not referenced"
        elif f["n_referenced_by"] >= 1 and len(cols) <= 3 and f["n_fk_out"] == 0:
            label, rule = "lookup", "referenced, ≤3 columns, no outgoing keys"
        elif f["n_referenced_by"] >= 1:
            label, rule = "dimension", "referenced by other tables"
        elif f["n_fk_out"] >= 1 and f["frac_numeric_measure"] > 0:
            label, rule = "fact", "references a table and carries numeric measures"
        else:
            label, rule = "other", "no rule matched"
        labels.append({"table": t, "label": label, "rule": rule, "evidence": {**f, "n_fds": n_fd}})
    return labels


MODEL2_SYSTEM = ("You are model_2, a table-type classifier inside a data profiling tool. "
                 "Answer only with the requested JSON.")

MODEL2_SCHEMA = {
    "type": "object",
    "properties": {"tables": {"type": "array", "items": {
        "type": "object",
        "properties": {"table": {"type": "string"}, "table_type": {"type": "string", "enum": TABLE_TYPES},
                       "confidence": {"type": "number"}, "rationale": {"type": "string"}},
        "required": ["table", "table_type", "confidence", "rationale"]}}},
    "required": ["tables"],
}


def _model2_prompt(column_semantics, key_relations, functional_dependencies, table_labels, classifier):
    blocks = []
    for lab in table_labels:
        t = lab["table"]
        cols = [f"{c['column']}:{c['semantic_type']}" for c in column_semantics if c["table"] == t]
        pk = next((n["primary_key"] for n in key_relations["nodes"] if n["id"] == t), None)
        fks = [f"{e['from_column']}→{e['to_table']}.{e['to_column']}" for e in key_relations["edges"]
               if e["from_table"] == t]
        refd = [f"{e['from_table']}.{e['from_column']}" for e in key_relations["edges"] if e["to_table"] == t]
        fds = [f"{e['lhs']}→{e['rhs']}" for e in functional_dependencies["edges"] if e["table"] == t]
        blocks.append(json.dumps({"table": t, "columns": cols, "primary_key": pk, "foreign_keys": fks,
                                  "referenced_by": refd, "functional_dependencies": fds[:15],
                                  "rule_label": lab["label"], "rule": lab["rule"],
                                  "features": lab["evidence"]}, ensure_ascii=False))
    types = "\n".join(f"- {k}: {v}" for k, v in TABLE_TYPE_HELP.items())
    guidance = ""
    if classifier and classifier.get("tree"):
        guidance = ("\n\nYou have been trained on human-corrected examples. Apply this learned decision tree "
                    "over the 'features' field as your primary guide, and use the examples as precedents:\n"
                    f"decision_tree = {json.dumps(classifier['tree'])}\n"
                    "examples = " + json.dumps([{"features": e["features"], "table_type": e["table_type"]}
                                                for e in classifier.get("examples", [])][:40]))
    return ("Classify each table of this database by its role. Allowed table types:\n" + types + guidance +
            "\n\nTables (one JSON object per line, with column semantic types, keys, functional dependencies "
            "and the label of a rule-based classifier):\n" + "\n".join(blocks) +
            "\n\nReturn {\"tables\": [...]} with table, table_type, confidence (0-1) and a one-sentence rationale "
            "for every table.")


def model2_assign_table_types(column_semantics, key_relations, functional_dependencies, table_labels, classifier):
    """[model_2 assign]~ column_semantics + key_relations + functional_dependencies + table_labels -> table_types*"""
    out = call_model(_model2_prompt(column_semantics, key_relations, functional_dependencies,
                                    table_labels, classifier), MODEL2_SCHEMA, MODEL2_SYSTEM)
    got = {p.get("table"): p for p in out.get("tables", [])}
    result = []
    for lab in table_labels:
        p = got.get(lab["table"])
        valid = bool(p) and p.get("table_type") in TABLE_TYPES
        result.append({"table": lab["table"],
                       "table_type": p["table_type"] if valid else lab["label"],
                       "confidence": max(0.0, min(1.0, float(p.get("confidence") or 0))) if valid else 0.0,
                       "rationale": str(p.get("rationale", ""))[:400] if valid
                       else "model gave no valid type; rule label kept", "valid": valid,
                       "classifier_version": (classifier or {}).get("version")})
    return result


# ---------------------------------------------------------------- compose profile
def compose_semantic_profile(column_semantics, key_relations, functional_dependencies, table_labels,
                             table_types, n_rows, version=1, parent=None, note="discovered"):
    """[tool_1 compose] -> semantic_profile (record)"""
    tables = []
    for lab, tt in zip(table_labels, table_types):
        t = lab["table"]
        node = next(n for n in key_relations["nodes"] if n["id"] == t)
        tables.append({
            "name": t, "n_rows": n_rows.get(t), "primary_key": node["primary_key"],
            "candidate_keys": node["candidate_keys"],
            "rule_label": lab["label"], "rule": lab["rule"], "evidence": lab["evidence"],
            "table_type": tt["table_type"], "type_confidence": tt["confidence"], "type_rationale": tt["rationale"],
            "columns": [c for c in column_semantics if c["table"] == t],
        })
    return {"version": version, "parent": parent, "note": note, "created_at": time.time(),
            "tables": tables, "key_relations": key_relations, "functional_dependencies": functional_dependencies}


def run_process2(store: Store, tables, detected_features, classifier, progress):
    progress("[tool_1 extract] column_attributes_1")
    attrs = extract_column_attributes(store, tables, detected_features)
    progress("[tool_1 assign] rule_taxonomies_1")
    rules = assign_rule_taxonomies(attrs)
    progress(f"[model_1 assign]~ predicted_taxonomies_1 ({len(attrs)} columns, calling model…)")
    preds = model1_assign_taxonomies(attrs, rules)
    progress("[tool_1 compose] column_semantics_1")
    sem = compose_column_semantics(attrs, rules, preds)
    progress("[tool_1 extract] key_relations_1")
    keys = extract_key_relations(store, tables, sem)
    progress("[tool_1 extract] functional_dependencies_1")
    fds = extract_functional_dependencies(store, tables, sem, keys)
    n_rows = {t: store.tables[t]["n_rows"] for t in tables}
    progress("[tool_1 assign] table_labels_1")
    labels = assign_table_labels(sem, keys, fds, n_rows)
    progress("[model_2 assign]~ table_types_1 (calling model…)")
    types = model2_assign_table_types(sem, keys, fds, labels, classifier)
    progress("[tool_1 compose] semantic_profile_1")
    profile = compose_semantic_profile(sem, keys, fds, labels, types, n_rows)
    return {"column_attributes": attrs, "rule_taxonomies": rules, "predicted_taxonomies": preds,
            "column_semantics": sem, "key_relations": keys, "functional_dependencies": fds,
            "table_labels": labels, "table_types": types, "semantic_profile": profile, "n_rows": n_rows}
