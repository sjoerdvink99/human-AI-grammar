"""model_2 — trainable key-role classifier (decision tree).

[model_2 assign]  r8 (+ graphs r9/r10 + r11) -> r12   (process 2)
[model_2 assign]  r13_2 + r19 -> r20                   (process 4)
[model_2 train]   r8 + r11 + r12_2 -> r22              (process 5)
"""
from __future__ import annotations

import numpy as np
from sklearn.tree import DecisionTreeClassifier

KEY_ROLES = ["primary_key", "foreign_key", "attribute"]

FEATURES = [
    "is_integer", "is_text", "distinct_ratio", "null_ratio", "is_unique",
    "name_id_like", "name_matches_table", "is_first_column",
    "sem_identifier", "sem_code", "sem_measure", "sem_name",
    "in_degree", "out_degree",
]


def feature_vector(col: dict) -> list[float]:
    return [float(col.get(f, 0.0)) for f in FEATURES]


class KeyClassifier:
    def __init__(self) -> None:
        self.tree: DecisionTreeClassifier | None = None
        self.trained_on = "untrained"
        self.version = 0

    def train(self, columns: list[dict], labels: dict[str, str], source: str) -> dict:
        """Fit on the given labels. Returns the tree as a graph (r22)."""
        X = np.array([feature_vector(c) for c in columns])
        y = np.array([labels[c["id"]] for c in columns])
        self.tree = DecisionTreeClassifier(max_depth=4, min_samples_leaf=1, random_state=0)
        self.tree.fit(X, y)
        self.trained_on = source
        self.version += 1
        return self.as_graph()

    def predict(self, columns: list[dict]) -> dict[str, dict]:
        """Assign a key role with confidence per column."""
        if self.tree is None:
            raise RuntimeError("classifier not trained")
        X = np.array([feature_vector(c) for c in columns])
        proba = self.tree.predict_proba(X)
        classes = list(self.tree.classes_)
        out = {}
        for c, p in zip(columns, proba):
            i = int(np.argmax(p))
            out[c["id"]] = {"label": classes[i], "confidence": round(float(p[i]), 3)}
        return out

    def as_graph(self) -> dict:
        """Export the fitted tree as nodes and links (r22: artifact graph)."""
        if self.tree is None:
            return {"nodes": [], "links": []}
        t = self.tree.tree_
        classes = list(self.tree.classes_)
        nodes, links = [], []
        for i in range(t.node_count):
            counts = t.value[i][0]
            leaf = t.children_left[i] == -1
            node = {
                "id": i,
                "leaf": bool(leaf),
                "samples": int(t.n_node_samples[i]),
                "class": classes[int(np.argmax(counts))],
                "distribution": {classes[k]: round(float(v), 3) for k, v in enumerate(counts)},
            }
            if not leaf:
                node["feature"] = FEATURES[t.feature[i]]
                node["threshold"] = round(float(t.threshold[i]), 3)
                links.append({"source": i, "target": int(t.children_left[i]), "branch": "≤"})
                links.append({"source": i, "target": int(t.children_right[i]), "branch": ">"})
            nodes.append(node)
        return {"nodes": nodes, "links": links, "version": self.version, "trained_on": self.trained_on}
