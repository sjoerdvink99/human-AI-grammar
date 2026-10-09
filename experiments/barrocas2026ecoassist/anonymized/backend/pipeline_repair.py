"""Process 3 (repair with the trained model) and process 4 (translate to final visual)."""
from __future__ import annotations

import diffing
import repair_model
from llm import ModelError, call_model_json
from metrics import METRIC_KEYS, evaluate_rendering
from render import CodeError, execute_code, translate_to_svg, validate_code


def improvement(r14: dict, r16: dict) -> dict:
    """tool_5 evaluate: r17 = change in score (and per metric) from r12_1 to r12_2."""
    return {
        "score_delta": round(r16["score"] - r14["score"], 2),
        "metric_deltas": {k: round(r16["metrics"][k] - r14["metrics"][k], 4) for k in METRIC_KEYS},
    }


def model_modify(r12_1: str, r9: dict, r14: dict, attempts: int = 2) -> dict:
    """model_2 modify: (r12_1 + r9 + r14) -> r12_2."""
    gains = repair_model.predict(r9, r14["metrics"])
    prompt = repair_model.build_modify_prompt(r12_1, r14, gains)
    err = None
    for _ in range(attempts):
        out = call_model_json(prompt if err is None else
                              prompt + f"\n\nYour previous reply was rejected: {err}. Fix it.",
                              repair_model.MODIFY_SYSTEM)
        code = str(out.get("code", ""))
        try:
            validate_code(code)
            return {"code": code, "rationale": str(out.get("rationale", "")), "gains": gains}
        except CodeError as e:
            err = str(e)
    raise ModelError(f"model_2 could not produce a valid program: {err}")


def run_repair(r12_1: str, progress=lambda stage: None) -> dict:
    r9 = repair_model.load()
    if r9 is None:
        raise ModelError("No trained repair model (r9). Run training first.")
    progress("tool_1 execute")
    r13 = execute_code(r12_1)
    progress("tool_2 evaluate")
    r14 = evaluate_rendering(r13)
    if not r14["ok"]:
        raise CodeError(f"The generated program failed to run: {r14.get('error')}")
    progress("model_2 modify")
    mod = model_modify(r12_1, r9, r14)
    r12_2 = mod["code"]
    progress("tool_1 execute")
    r15 = execute_code(r12_2)
    progress("tool_2 evaluate")
    r16 = evaluate_rendering(r15)
    progress("tool_5 evaluate")
    r17 = improvement(r14, r16)
    progress("tool_5 extract")
    r18 = diffing.extract_hunks(r12_1, r12_2)
    return {
        "r12_1": r12_1, "r12_2": r12_2, "r13_png": r13.get("png"), "r14": r14,
        "r15_png": r15.get("png"), "r16": r16, "r17": r17, "r18": r18,
        "rationale": mod["rationale"], "gains": mod["gains"],
    }


def apply_selection(r12_1: str, r12_2: str, r19: list[int]) -> str:
    """tool_5 modify: (r12_1 + r18 + r19) -> r12_3."""
    return diffing.apply_hunks(r12_1, r12_2, r19)


def translate(r12_3: str) -> dict:
    """Process 4, tool_5 translate: r12_3 -> r20 (SVG)."""
    res = translate_to_svg(r12_3)
    if not res.get("ok"):
        raise CodeError(f"The final program failed to render: {res.get('error')}")
    return {"r20_svg": res["svg"]}
