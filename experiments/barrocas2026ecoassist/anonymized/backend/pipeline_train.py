"""Process 1: build training data from the corpus and train the repair model.

(r1_1)* -> [tool_1 execute] -> (r2_1)* -> [tool_2 evaluate] -> (r3_1)*
 -> [tool_3 modify] -> (r1_2)* -> [tool_1 execute] -> (r4_1)* -> [tool_2 evaluate] -> (r5_1)*
 -> [tool_4 evaluate] -> (r6_1)* -> [tool_4 compose] -> (r7_1)* -> [tool_4 select] -> (r8_1)*
 -> [model_2 train] -> (r9_1)
"""
from __future__ import annotations

import json
import os

import corpus
import repair_model
from metrics import evaluate_rendering
from mutations import OPERATOR_KEYS, apply_operator
from render import execute_many

SELECT_MIN_DELTA = 0.5  # tool_4 select: keep records whose edit improved the score by > 0.5 points


def score_deltas(r3: dict, r5: dict, variants: dict) -> dict:
    """tool_4 evaluate: r6 = score change of each variant against its original."""
    return {vid: round(r5[vid]["score"] - r3[v["script_id"]]["score"], 2)
            for vid, v in variants.items() if r5[vid]["ok"] and r3[v["script_id"]]["ok"]}


def compose_records(r3: dict, r5: dict, r6: dict, variants: dict) -> list[dict]:
    """tool_4 compose: r7 training records."""
    return [{
        "variant_id": vid,
        "script_id": variants[vid]["script_id"],
        "operator": variants[vid]["operator"],
        "before": r3[variants[vid]["script_id"]],
        "after": r5[vid],
        "delta": delta,
    } for vid, delta in r6.items()]


def select_records(r7: list[dict]) -> list[dict]:
    """tool_4 select: r8 = records whose edit improved the chart."""
    return [r for r in r7 if r["delta"] > SELECT_MIN_DELTA]


def run(progress=lambda stage, info=None: None) -> dict:
    r1_1 = corpus.list_scripts()
    progress("tool_1 execute", f"rendering {len(r1_1)} corpus programs")
    r2_1 = execute_many([(s["id"], s["code"]) for s in r1_1])

    progress("tool_2 evaluate", "scoring originals")
    r3_1 = {sid: evaluate_rendering(r) for sid, r in r2_1.items()}

    progress("tool_3 modify", f"applying {len(OPERATOR_KEYS)} edit operators")
    r1_2 = {}
    for s in r1_1:
        if not r3_1[s["id"]]["ok"]:
            continue
        for op in OPERATOR_KEYS:
            vid = f"{s['id']}::{op}"
            r1_2[vid] = {"script_id": s["id"], "operator": op, "code": apply_operator(s["code"], op)}

    progress("tool_1 execute", f"rendering {len(r1_2)} variants")
    r4_1 = execute_many([(vid, v["code"]) for vid, v in r1_2.items()])

    progress("tool_2 evaluate", "scoring variants")
    r5_1 = {vid: evaluate_rendering(r) for vid, r in r4_1.items()}

    progress("tool_4 evaluate", "computing score deltas")
    r6_1 = score_deltas(r3_1, r5_1, r1_2)

    progress("tool_4 compose", "building training records")
    r7_1 = compose_records(r3_1, r5_1, r6_1, r1_2)

    progress("tool_4 select", "keeping improving edits")
    r8_1 = select_records(r7_1)

    progress("model_2 train", f"fitting on {len(r8_1)} records")
    r9_1 = repair_model.train(r8_1)

    with open(os.path.join(repair_model.DATA_DIR, "training_records.json"), "w") as f:
        json.dump({"r7": r7_1, "selected_ids": [r["variant_id"] for r in r8_1]}, f)

    # summary for the UI: thumbnails of originals and best variant per script
    corpus_view = []
    for s in r1_1:
        rows = [r for r in r7_1 if r["script_id"] == s["id"]]
        corpus_view.append({
            "id": s["id"], "title": s["title"],
            "r2_png": r2_1[s["id"]].get("png"), "r3": r3_1[s["id"]],
            "variants": [{
                "operator": r["operator"], "r5": r["after"], "r6": r["delta"],
                "selected": r["delta"] > SELECT_MIN_DELTA,
                "r4_png": r4_1[r["variant_id"]].get("png"),
            } for r in sorted(rows, key=lambda r: -r["delta"])],
        })
    return {"corpus": corpus_view, "n_r7": len(r7_1), "n_r8": len(r8_1), "r9": r9_1}
