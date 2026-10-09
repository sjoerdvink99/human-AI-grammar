"""Process 4 — the user edits the semantic profile; table labels and types are re-derived."""
from p2_profile import assign_table_labels, compose_semantic_profile, model2_assign_table_types
from taxonomy import SEMANTIC_TYPES


class EditError(ValueError):
    pass


def normalize_edited_profile(edited, base):
    """Validate a human-modified profile (semantic_profile_2) against the base version."""
    tables = {t["name"]: t for t in base["tables"]}
    cols = {(t["name"], c["column"]): c for t in base["tables"] for c in t["columns"]}
    column_semantics, nodes = [], []
    for et in edited.get("tables", []):
        if et.get("name") not in tables:
            raise EditError(f"unknown table {et.get('name')}")
        bt = tables[et["name"]]
        pk = et.get("primary_key")
        if pk is not None and (et["name"], pk) not in cols:
            raise EditError(f"primary key {pk} is not a column of {et['name']}")
        nodes.append({"id": et["name"], "kind": "table", "primary_key": pk,
                      "candidate_keys": bt.get("candidate_keys", [])})
        for ec in et.get("columns", []):
            key = (et["name"], ec.get("column"))
            if key not in cols:
                raise EditError(f"unknown column {key}")
            st = ec.get("semantic_type")
            if st not in SEMANTIC_TYPES:
                raise EditError(f"{st!r} is not in the semantic type taxonomy")
            c = dict(cols[key])
            if st != c["semantic_type"]:
                c["semantic_type"], c["source"] = st, "human"
            column_semantics.append(c)
    edges = []
    for e in edited.get("key_relations", {}).get("edges", []):
        if (e["from_table"], e["from_column"]) not in cols or (e["to_table"], e["to_column"]) not in cols:
            raise EditError(f"foreign key {e.get('id')} refers to unknown columns")
        edges.append({**e, "id": f"fk:{e['from_table']}.{e['from_column']}->{e['to_table']}.{e['to_column']}",
                      "kind": "foreign_key"})
    fds = []
    for e in edited.get("functional_dependencies", {}).get("edges", []):
        if (e["table"], e["lhs"]) not in cols or (e["table"], e["rhs"]) not in cols:
            raise EditError(f"functional dependency {e.get('id')} refers to unknown columns")
        fds.append(e)
    return column_semantics, {"nodes": nodes, "edges": edges}, {"edges": fds}


def run_process4(edited, base, next_version, classifier, progress):
    progress("[human modify] semantic_profile_2 (validating edits)")
    sem, keys, fds = normalize_edited_profile(edited, base)
    n_rows = {t["name"]: t["n_rows"] for t in base["tables"]}
    progress("[tool_1 assign] refined_table_labels_1")
    labels = assign_table_labels(sem, keys, fds, n_rows)
    progress("[model_2 assign]~ refined_table_types_1 (calling model…)")
    types = model2_assign_table_types(sem, keys, fds, labels, classifier)
    profile = compose_semantic_profile(sem, keys, fds, labels, types, n_rows, version=next_version,
                                       parent=base["version"], note="human edit")
    return {"refined_table_labels": labels, "refined_table_types": types, "semantic_profile": profile}
