"""tool_5 extract (r12_1 + r12_2 -> r18 hunks) and tool_5 modify (apply selected hunks r19 -> r12_3)."""
from __future__ import annotations

import difflib


def _lines(code: str) -> list[str]:
    return code.rstrip("\n").split("\n")


def extract_hunks(old: str, new: str, context: int = 2) -> list[dict]:
    """Each non-equal opcode becomes one independently selectable hunk."""
    a, b = _lines(old), _lines(new)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    hunks = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        hunks.append({
            "id": len(hunks),
            "tag": tag,
            "old_start": i1 + 1,
            "old_lines": a[i1:i2],
            "new_lines": b[j1:j2],
            "context_before": a[max(0, i1 - context):i1],
            "context_after": a[i2:i2 + context],
            "range": [i1, i2, j1, j2],
        })
    return hunks


def apply_hunks(old: str, new: str, selected_ids: list[int]) -> str:
    """Rebuild the program taking the new side only for selected hunks."""
    a, b = _lines(old), _lines(new)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    selected = set(selected_ids)
    out, hid = [], 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            out += a[i1:i2]
            continue
        out += b[j1:j2] if hid in selected else a[i1:i2]
        hid += 1
    return "\n".join(out) + "\n"


def unified(old: str, new: str) -> str:
    return "\n".join(difflib.unified_diff(_lines(old), _lines(new), "r12_1", "r12_3", lineterm=""))
