"""Process 5 — the user corrects table types; model_2 is retrained on the corrections.

The 'training' of model_2 is done by the model itself: it induces a small decision tree over
table-level features from all human-labelled examples. The tree is validated and scored in code,
persisted, and then given to model_2 as its learned policy in every later [model_2 assign] call.
"""
import json
import os
import time

from llm import call_model
from taxonomy import TABLE_FEATURES, TABLE_TYPE_HELP, TABLE_TYPES

CLASSIFIER_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "classifier.json")
OPS = {"<=": lambda a, b: a <= b, ">": lambda a, b: a > b, "<": lambda a, b: a < b,
       ">=": lambda a, b: a >= b, "==": lambda a, b: a == b}


class TrainingError(ValueError):
    pass


def load_classifier():
    try:
        with open(CLASSIFIER_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save_classifier(c):
    os.makedirs(os.path.dirname(CLASSIFIER_PATH), exist_ok=True)
    with open(CLASSIFIER_PATH, "w") as f:
        json.dump(c, f, indent=2)


def apply_corrections(table_types, corrections):
    """[human modify] table_types_1* -> table_types_2*"""
    by_table = {c["table"]: c["table_type"] for c in corrections}
    out = []
    for tt in table_types:
        new = by_table.get(tt["table"], tt["table_type"])
        if new not in TABLE_TYPES:
            raise TrainingError(f"{new!r} is not a table type")
        out.append({**tt, "table_type": new, "corrected": new != tt["table_type"],
                    "model_type": tt.get("model_type", tt["table_type"])})
    return out


def _num(v):
    return float(v) if not isinstance(v, bool) else (1.0 if v else 0.0)


def predict(tree, features):
    nodes = {n["id"]: n for n in tree["nodes"]}
    node, depth = nodes[tree["root"]], 0
    while "label" not in node or not node.get("label"):
        depth += 1
        if depth > 12:
            raise TrainingError("decision tree has a cycle")
        ok = OPS[node["op"]](_num(features[node["feature"]]), float(node["threshold"]))
        node = nodes[node["yes"] if ok else node["no"]]
    return node["label"]


def validate_tree(tree):
    nodes = tree.get("nodes") or []
    ids = {n.get("id") for n in nodes}
    if len(ids) != len(nodes):
        raise TrainingError("duplicate node ids")
    if tree.get("root") not in ids:
        raise TrainingError("root is not a node")
    for n in nodes:
        if n.get("label"):
            if n["label"] not in TABLE_TYPES:
                raise TrainingError(f"leaf label {n['label']!r} not a table type")
        else:
            if n.get("feature") not in TABLE_FEATURES:
                raise TrainingError(f"unknown feature {n.get('feature')!r}")
            if n.get("op") not in OPS:
                raise TrainingError(f"unknown operator {n.get('op')!r}")
            if not isinstance(n.get("threshold"), (int, float)):
                raise TrainingError("threshold must be a number")
            if n.get("yes") not in ids or n.get("no") not in ids:
                raise TrainingError(f"node {n['id']} has a dangling branch")


TREE_SCHEMA = {
    "type": "object",
    "properties": {
        "root": {"type": "string"},
        "nodes": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"},
            "feature": {"type": "string", "enum": TABLE_FEATURES},
            "op": {"type": "string", "enum": list(OPS)},
            "threshold": {"type": "number"},
            "yes": {"type": "string"}, "no": {"type": "string"},
            "label": {"type": "string", "enum": TABLE_TYPES}}, "required": ["id"]}},
        "summary": {"type": "string"},
    },
    "required": ["root", "nodes", "summary"],
}


def _train_prompt(examples, previous_tree, error=None):
    rows = "\n".join(json.dumps({"table": e["table"], "features": e["features"], "table_type": e["table_type"]})
                     for e in examples)
    types = "\n".join(f"- {k}: {v}" for k, v in TABLE_TYPE_HELP.items())
    prev = f"\nThe previous tree was:\n{json.dumps(previous_tree)}\nRevise it to fit the new labels.\n" \
        if previous_tree else ""
    err = f"\nYour previous answer was invalid: {error}. Fix it.\n" if error else ""
    return ("You are training a table-type classifier. Induce a small decision tree (depth ≤ 4) that "
            "predicts table_type from the numeric table features, fitting the human-labelled examples below "
            "as accurately as possible while staying general (prefer thresholds that reflect the meaning of "
            "the types). Booleans count as 0/1.\n"
            f"Table types:\n{types}\nFeatures: {', '.join(TABLE_FEATURES)}\n{prev}{err}\n"
            f"Labelled examples (one per line):\n{rows}\n\n"
            "Return the tree as a flat node list: internal nodes have id, feature, op, threshold, yes (node id "
            "when the test is true) and no; leaves have id and label. Give the root id and a one-paragraph "
            "summary of what the tree learned.")


def train_table_classifier(column_semantics, table_labels, table_types_2, progress):
    """[model_2 train] column_semantics_1* + table_labels_1* + table_types_2* -> updated_table_classifier_1"""
    previous = load_classifier()
    examples = {(e["table"], e["features"]["n_columns"]): e for e in (previous or {}).get("examples", [])}
    evidence = {l["table"]: l["evidence"] for l in table_labels}
    for tt in table_types_2:
        f = {k: evidence[tt["table"]][k] for k in TABLE_FEATURES}
        examples[(tt["table"], f["n_columns"])] = {
            "table": tt["table"], "features": f, "table_type": tt["table_type"],
            "columns": [c["column"] + ":" + c["semantic_type"] for c in column_semantics
                        if c["table"] == tt["table"]], "labelled_at": time.time()}
    examples = list(examples.values())
    error = None
    for attempt in range(2):
        progress(f"[model_2 train] inducing decision tree from {len(examples)} examples"
                 + (" (retry)" if attempt else "") + "…")
        tree = call_model(_train_prompt(examples, (previous or {}).get("tree"), error), TREE_SCHEMA)
        try:
            validate_tree(tree)
            preds = [predict(tree, e["features"]) for e in examples]
            break
        except (TrainingError, KeyError, TypeError) as e:
            error = str(e)
    else:
        raise TrainingError(f"model produced an invalid tree twice: {error}")
    correct = sum(p == e["table_type"] for p, e in zip(preds, examples))
    classifier = {
        "version": ((previous or {}).get("version") or 0) + 1, "trained_at": time.time(),
        "tree": {"root": tree["root"], "nodes": tree["nodes"]}, "summary": tree.get("summary", ""),
        "examples": examples, "training_accuracy": round(correct / len(examples), 3),
        "predictions": [{"table": e["table"], "label": e["table_type"], "predicted": p}
                        for e, p in zip(examples, preds)],
    }
    save_classifier(classifier)
    return classifier
