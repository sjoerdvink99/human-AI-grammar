"""Table labels (tool_1 assign) and the decision-tree table-type classifier (model_2:
assign and train). Corrections from process 5 are persisted and used for every later prediction."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.tree import DecisionTreeClassifier

TABLE_TYPES = {
    "entity": "describes real-world things (customers, products)",
    "event": "records transactions or happenings over time (orders, logs)",
    "bridge": "links other tables in a many-to-many relationship",
    "lookup": "small reference list of codes and names",
}

TABLE_LABELS = {
    "has_single_key": "a single-column primary key",
    "has_composite_key": "a multi-column primary key",
    "no_key": "no primary key found",
    "has_temporal": "at least one date/time column",
    "has_measures": "monetary, quantity, measurement or percentage columns",
    "has_descriptive": "names, titles, text or contact columns",
    "references_one": "exactly one foreign key",
    "references_many": "two or more foreign keys",
    "referenced_by_others": "other tables point to it",
    "mostly_keys": "at least half of its columns are key columns",
    "few_rows": "fewer than 50 rows",
    "few_columns": "three columns or fewer",
    "has_internal_fds": "non-key functional dependencies (denormalised)",
}
LABEL_ORDER = list(TABLE_LABELS)
MEASURES = {"monetary", "quantity", "measurement", "percentage"}
DESCRIPTIVE = {"person_name", "organization", "title_or_label", "free_text", "email", "phone", "address", "url", "city"}

CORRECTIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "classifier_corrections.json"
CORRECTION_WEIGHT = 3.0

# Hand-written seed examples (labels -> type), the classifier's starting knowledge.
SEED = [
    ("lookup", ["has_single_key", "few_rows", "few_columns", "referenced_by_others", "has_descriptive"]),
    ("lookup", ["has_single_key", "few_rows", "few_columns", "referenced_by_others"]),
    ("lookup", ["has_single_key", "few_rows", "referenced_by_others", "has_descriptive"]),
    ("lookup", ["has_single_key", "few_rows", "few_columns"]),
    ("entity", ["has_single_key", "has_descriptive", "referenced_by_others", "has_temporal"]),
    ("entity", ["has_single_key", "has_descriptive", "references_one", "referenced_by_others", "has_measures"]),
    ("entity", ["has_single_key", "has_descriptive", "references_one", "has_internal_fds", "has_temporal", "referenced_by_others"]),
    ("entity", ["has_single_key", "has_descriptive", "has_measures", "references_one"]),
    ("entity", ["has_single_key", "has_descriptive"]),
    ("entity", ["has_single_key", "has_descriptive", "few_rows", "has_temporal", "references_one"]),
    ("event", ["has_single_key", "has_temporal", "has_measures", "references_one"]),
    ("event", ["has_single_key", "has_temporal", "has_measures", "references_many", "referenced_by_others"]),
    ("event", ["has_single_key", "has_temporal", "has_measures", "referenced_by_others", "has_internal_fds"]),
    ("event", ["no_key", "has_temporal", "has_measures", "references_one"]),
    ("event", ["no_key", "has_temporal", "references_many"]),
    ("event", ["has_single_key", "has_temporal", "references_many"]),
    ("event", ["has_single_key", "has_temporal", "has_measures", "has_descriptive", "references_one", "referenced_by_others"]),
    ("event", ["has_single_key", "has_temporal", "has_measures", "has_descriptive", "referenced_by_others", "has_internal_fds"]),
    ("event", ["has_single_key", "has_temporal", "has_measures", "has_descriptive", "references_many"]),
    ("bridge", ["has_composite_key", "mostly_keys", "references_many"]),
    ("bridge", ["has_composite_key", "mostly_keys", "references_many", "has_measures"]),
    ("bridge", ["has_composite_key", "references_many", "has_measures", "has_internal_fds"]),
    ("bridge", ["no_key", "mostly_keys", "references_many", "few_columns"]),
    ("bridge", ["has_composite_key", "mostly_keys", "references_one", "few_columns"]),
]


# --------------------------------------------------------------------------- [tool_1 assign]
def assign_table_labels(tables: list[dict], column_semantics: list[dict], key_relations: dict,
                        functional_dependencies: list[dict]) -> dict[str, list[str]]:
    labels: dict[str, list[str]] = {}
    pks = key_relations.get("primary_keys", {})
    fks = key_relations.get("foreign_keys", [])
    for t in tables:
        name = t["name"]
        cols = [c for c in column_semantics if c["table"] == name]
        pk = pks.get(name) or []
        out_fk = [f for f in fks if f["from_table"] == name]
        in_fk = [f for f in fks if f["to_table"] == name]
        cats = {c["category"] for c in cols}
        key_cols = set(pk) | {f["from_column"] for f in out_fk}
        tl = []
        tl.append("has_single_key" if len(pk) == 1 else "has_composite_key" if len(pk) > 1 else "no_key")
        if "temporal" in cats:
            tl.append("has_temporal")
        if cats & MEASURES:
            tl.append("has_measures")
        if cats & DESCRIPTIVE:
            tl.append("has_descriptive")
        if len({f["to_table"] for f in out_fk}) == 1:
            tl.append("references_one")
        elif len({f["to_table"] for f in out_fk}) >= 2:
            tl.append("references_many")
        if in_fk:
            tl.append("referenced_by_others")
        if cols and len(key_cols) >= len(cols) / 2:
            tl.append("mostly_keys")
        if t["rows"] < 50:
            tl.append("few_rows")
        if len(cols) <= 3:
            tl.append("few_columns")
        if any(fd["table"] == name for fd in functional_dependencies):
            tl.append("has_internal_fds")
        labels[name] = tl
    return labels


def _vec(labels: list[str]) -> list[int]:
    return [1 if lab in labels else 0 for lab in LABEL_ORDER]


class TableClassifier:
    """model_2: decision tree over the table labels."""

    def __init__(self, corrections_path: Path = CORRECTIONS_PATH):
        self.corrections_path = corrections_path
        self.corrections: list[dict] = self._load()
        self.version = 0
        self.tree: DecisionTreeClassifier | None = None
        self.fit()

    def _load(self) -> list[dict]:
        try:
            return json.loads(self.corrections_path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def _save(self):
        self.corrections_path.parent.mkdir(parents=True, exist_ok=True)
        self.corrections_path.write_text(json.dumps(self.corrections, indent=1))

    def fit(self):
        X = [_vec(l) for _, l in SEED] + [_vec(c["labels"]) for c in self.corrections]
        y = [t for t, _ in SEED] + [c["type"] for c in self.corrections]
        w = [1.0] * len(SEED) + [CORRECTION_WEIGHT] * len(self.corrections)
        self.tree = DecisionTreeClassifier(random_state=0, criterion="entropy")
        self.tree.fit(np.array(X), np.array(y), sample_weight=np.array(w))
        self.version += 1

    # [model_2 assign]
    def predict(self, table_labels: dict[str, list[str]]) -> dict[str, dict]:
        names = list(table_labels)
        if not names:
            return {}
        X = np.array([_vec(table_labels[n]) for n in names])
        probs = self.tree.predict_proba(X)
        leaves = self.tree.apply(X)
        out = {}
        for n, p, leaf in zip(names, probs, leaves):
            i = int(np.argmax(p))
            out[n] = {"type": str(self.tree.classes_[i]), "confidence": round(float(p[i]), 3),
                      "leaf": int(leaf), "path": self.decision_path(table_labels[n])}
        return out

    def decision_path(self, labels: list[str]) -> list[dict]:
        t = self.tree.tree_
        node, path, x = 0, [], _vec(labels)
        while t.children_left[node] != -1:
            f = int(t.feature[node])
            has = bool(x[f])
            path.append({"node": node, "label": LABEL_ORDER[f], "present": has})
            node = int(t.children_right[node] if has else t.children_left[node])
        path.append({"node": node, "leaf": True})
        return path

    # [model_2 train]
    def train_with_correction(self, table: str, labels: list[str], corrected_type: str, predicted: str | None):
        if corrected_type not in TABLE_TYPES:
            raise ValueError(f"unknown table type {corrected_type}")
        self.corrections.append({"table": table, "labels": list(labels), "type": corrected_type, "predicted": predicted})
        self._save()
        self.fit()
        return self.graph()

    def reset(self):
        self.corrections = []
        self._save()
        self.fit()

    def graph(self) -> dict:
        """updated_table_classifier: the tree as nodes and links."""
        t = self.tree.tree_
        classes = [str(c) for c in self.tree.classes_]
        nodes, links = [], []
        for i in range(t.node_count):
            counts = t.value[i][0]
            leaf = t.children_left[i] == -1
            nodes.append({
                "id": i,
                "label": None if leaf else LABEL_ORDER[int(t.feature[i])],
                "leaf": bool(leaf),
                "class": classes[int(np.argmax(counts))],
                "distribution": {c: round(float(v), 3) for c, v in zip(classes, counts)},
                "samples": int(t.n_node_samples[i]),
            })
            if not leaf:
                links.append({"source": i, "target": int(t.children_left[i]), "branch": "no"})
                links.append({"source": i, "target": int(t.children_right[i]), "branch": "yes"})
        return {"version": self.version, "nodes": nodes, "links": links,
                "training_examples": len(SEED) + len(self.corrections),
                "corrections": self.corrections}
