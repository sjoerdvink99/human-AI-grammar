"""model_2: the repair model.

* train (process 1): fits r9, a numeric weight matrix, from selected training
  records r8. One ridge-regression row per edit operator predicts the score gain
  of that operator from a program's metric profile.
* modify (process 3): conditions an LLM on the program r12_1, its metrics r14 and
  the operator gains predicted by r9, and returns the repaired program r12_2.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import numpy as np

from metrics import METRIC_KEYS, METRICS
from mutations import OPERATORS, OPERATOR_KEYS

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
WEIGHTS_PATH = os.path.join(DATA_DIR, "weights.json")
RIDGE = 0.1


def _features(metrics: dict) -> np.ndarray:
    return np.array([metrics[k] for k in METRIC_KEYS] + [1.0])


def train(records: list[dict]) -> dict:
    """model_2 train: r8 -> r9."""
    feature_names = METRIC_KEYS + ["bias"]
    d = len(feature_names)
    weights, counts = {}, {}
    for op in OPERATOR_KEYS:
        rows = [r for r in records if r["operator"] == op]
        counts[op] = len(rows)
        if not rows:
            weights[op] = [0.0] * d
            continue
        X = np.stack([_features(r["before"]["metrics"]) for r in rows])
        y = np.array([r["delta"] for r in rows])
        A = X.T @ X + RIDGE * np.eye(d)
        A[-1, -1] -= RIDGE  # do not regularise the bias
        w = np.linalg.lstsq(A, X.T @ y, rcond=None)[0]
        weights[op] = [round(float(v), 4) for v in w]
    r9 = {
        "feature_names": feature_names,
        "operators": OPERATOR_KEYS,
        "weights": weights,
        "support": counts,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "n_records": len(records),
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(WEIGHTS_PATH, "w") as f:
        json.dump(r9, f, indent=2)
    return r9


def load() -> dict | None:
    if not os.path.exists(WEIGHTS_PATH):
        return None
    with open(WEIGHTS_PATH) as f:
        return json.load(f)


def predict(r9: dict, metrics: dict) -> list[dict]:
    """Predicted score gain of every operator for a metric profile, best first."""
    x = _features(metrics)
    out = []
    for op in r9["operators"]:
        gain = float(np.dot(np.array(r9["weights"][op]), x))
        if r9["support"].get(op, 0) == 0:
            gain = 0.0
        out.append({"operator": op, "description": OPERATORS[op][0],
                    "predicted_gain": round(gain, 2), "support": r9["support"].get(op, 0)})
    return sorted(out, key=lambda o: -o["predicted_gain"])


MODIFY_SYSTEM = (
    "You are model_2, a chart-repair model. You revise matplotlib programs so their rendered "
    "chart is more readable, guided by measured quality metrics and by learned edit priorities. "
    "You never change the data, the chart type, or the meaning of the chart. Reply with JSON only."
)


def build_modify_prompt(code: str, r14: dict, gains: list[dict]) -> str:
    metric_lines = "\n".join(
        f"- {label} ({key}): penalty {r14['metrics'][key]:.2f}" for key, label, _ in METRICS)
    gain_lines = "\n".join(
        f"- {g['operator']}: predicted +{g['predicted_gain']:.1f} points — {g['description']}"
        for g in gains if g["predicted_gain"] > 0.05) or "- (no edit is predicted to help)"
    return f"""Repair this matplotlib program.

PROGRAM (r12_1):
```python
{code}
```

MEASURED QUALITY (r14), overall score {r14['score']:.1f}/100, penalties in [0,1] where 0 is best:
{metric_lines}

LEARNED EDIT PRIORITIES from the trained repair model (r9), highest predicted gain first:
{gain_lines}

Rules:
- Apply the highest-priority edits that address the non-zero penalties. You may also add a missing
  title or axis labels when 'missing_labels' is above zero, inferring them from the code.
- Edit the program in place (change arguments, add lines); keep unchanged lines byte-identical so a
  line diff shows only your edits. Do not reorder or reformat untouched code.
- Keep the same data, chart type and imports. Allowed imports: matplotlib, numpy, math, random, datetime.
- Do not call plt.show(), plt.savefig() or open files.

Return JSON: {{"code": "<full revised program>", "rationale": "<one or two sentences>"}}"""
