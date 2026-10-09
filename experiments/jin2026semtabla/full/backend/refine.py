"""Process 4 — Refine Inferred Semantics, and process 5 — Update Table Classifier from Corrections."""
from __future__ import annotations

import copy

from .enrichment import classify_tables
from .store import Workspace
from .table_classifier import TABLE_TYPES, TableClassifier, assign_table_labels
from .taxonomy import TAXONOMY


class EditError(ValueError):
    pass


def _table(profile, name):
    t = next((x for x in profile["tables"] if x["name"] == name), None)
    if t is None:
        raise EditError(f"unknown table {name}")
    return t


def _column(profile, table, column):
    c = next((x for x in profile["columns"] if x["table"] == table and x["column"] == column), None)
    if c is None:
        raise EditError(f"unknown column {table}.{column}")
    return c


# --------------------------------------------------------------------------- [human modify] -> semantic_profile_2
def apply_edits(profile: dict, edits: list[dict]) -> dict:
    p = copy.deepcopy(profile)
    for e in edits:
        op = e.get("op")
        if op == "set_taxonomy":
            if e["category"] not in TAXONOMY:
                raise EditError(f"unknown category {e['category']}")
            c = _column(p, e["table"], e["column"])
            c.update(category=e["category"], source="user", confidence=1.0, rationale="set by user")
        elif op == "set_primary_key":
            t = _table(p, e["table"])
            for col in e["columns"]:
                _column(p, e["table"], col)
            t["primary_key"] = list(e["columns"])
        elif op == "add_foreign_key":
            _column(p, e["from_table"], e["from_column"])
            _column(p, e["to_table"], e["to_column"])
            fk = {k: e[k] for k in ("from_table", "from_column", "to_table", "to_column")}
            if not any(all(f[k] == fk[k] for k in fk) for f in p["foreign_keys"]):
                p["foreign_keys"].append({**fk, "source": "user"})
        elif op == "remove_foreign_key":
            p["foreign_keys"] = [f for f in p["foreign_keys"]
                                 if not all(f[k] == e[k] for k in ("from_table", "from_column", "to_table", "to_column"))]
        elif op == "add_fd":
            _column(p, e["table"], e["lhs"])
            _column(p, e["table"], e["rhs"])
            if not any(d["table"] == e["table"] and d["lhs"] == e["lhs"] and d["rhs"] == e["rhs"]
                       for d in p["functional_dependencies"]):
                p["functional_dependencies"].append({"table": e["table"], "lhs": e["lhs"], "rhs": e["rhs"], "source": "user"})
        elif op == "remove_fd":
            p["functional_dependencies"] = [d for d in p["functional_dependencies"]
                                            if not (d["table"] == e["table"] and d["lhs"] == e["lhs"] and d["rhs"] == e["rhs"])]
        else:
            raise EditError(f"unknown edit op '{op}'")
    return p


def refine(ws: Workspace, edits: list[dict], classifier: TableClassifier) -> dict:
    if ws.profile is None:
        raise EditError("no semantic profile yet; run the enrichment stages first")
    p2 = apply_edits(ws.profile, edits)
    # [tool_1 assign] refined_table_labels
    key_relations = {"primary_keys": {t["name"]: t["primary_key"] for t in p2["tables"]},
                     "foreign_keys": p2["foreign_keys"]}
    labels = assign_table_labels([{"name": t["name"], "rows": t["rows"]} for t in p2["tables"]],
                                 p2["columns"], key_relations, p2["functional_dependencies"])
    # [model_2 assign] refined_table_types
    types = classify_tables(classifier, labels, ws.type_overrides)
    previous = {t["name"]: t["type"] for t in p2["tables"]}
    for t in p2["tables"]:
        tt = types[t["name"]]
        t.update(labels=labels[t["name"]], type=tt["type"], type_confidence=tt["confidence"],
                 type_source=tt["source"], type_path=tt["path"], previous_type=previous[t["name"]])
    p2["edits"] = edits
    return ws.push_profile(p2)


# --------------------------------------------------------------------------- process 5
def correct_table_type(ws: Workspace, table: str, new_type: str, classifier: TableClassifier) -> dict:
    """[human modify] table_types_1 -> table_types_2, then [model_2 train] -> updated_table_classifier."""
    if new_type not in TABLE_TYPES:
        raise EditError(f"unknown table type {new_type}")
    if ws.profile is None:
        raise EditError("no semantic profile yet")
    t = _table(ws.profile, table)
    predicted = t["type"]
    ws.type_overrides[table] = new_type
    t.update(type=new_type, type_source="user", type_confidence=1.0)  # show the correction immediately
    if ws.table_types is not None and table in ws.table_types:
        ws.table_types[table].update(type=new_type, source="user", confidence=1.0)
    graph = classifier.train_with_correction(table, t["labels"], new_type, predicted)
    return {"updated_table_classifier": graph, "semantic_profile": ws.profile}
