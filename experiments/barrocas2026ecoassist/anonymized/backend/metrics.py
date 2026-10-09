"""tool_2 evaluate: rendering -> numeric quality metrics.

All penalties are in [0, 1] (0 = no problem). The overall score is 100 minus a
weighted sum of penalties, clipped to [0, 100].
"""
from __future__ import annotations

import math

METRICS = [
    ("text_overlap", "Overlapping text labels", 35),
    ("clipped_text", "Text cut off at the figure edge", 25),
    ("small_text", "Text smaller than 8 pt", 10),
    ("legend_occlusion", "Legend covering data marks", 15),
    ("whitespace", "Excess empty canvas", 15),
    ("missing_labels", "Missing title or axis labels", 10),
]
METRIC_KEYS = [m[0] for m in METRICS]
WEIGHTS = {k: w for k, _, w in METRICS}


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _inter(a, b):
    return [max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])]


def _corners(t, shrink=0.85):
    """Corners of the (possibly rotated) text rectangle, shrunk to tolerate touching boxes."""
    b = t["bbox"]
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    w, h = t.get("w", b[2] - b[0]) * shrink / 2, t.get("h", b[3] - b[1]) * shrink / 2
    a = math.radians(-t.get("rot", 0.0))  # image y axis points down
    c, s = math.cos(a), math.sin(a)
    return [(cx + dx * c - dy * s, cy + dx * s + dy * c) for dx, dy in ((-w, -h), (w, -h), (w, h), (-w, h))]


def _polys_overlap(p, q):
    """Separating axis test for two convex quadrilaterals."""
    for poly in (p, q):
        for i in range(4):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % 4]
            nx, ny = y2 - y1, x1 - x2
            pa = [nx * x + ny * y for x, y in p]
            pb = [nx * x + ny * y for x, y in q]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


def evaluate_rendering(rendering: dict) -> dict:
    """Return {'ok', 'score', 'metrics': {key: penalty}} for one rendering."""
    if not rendering.get("ok"):
        return {"ok": False, "score": 0.0, "metrics": {k: 1.0 for k in METRIC_KEYS},
                "error": rendering.get("error", "render failed")}
    lay = rendering["layout"]
    W, H = lay["width"], lay["height"]
    texts = lay["texts"]
    n = len(texts)

    # text overlap: fraction of text items whose (rotated) box collides with another
    colliding = set()
    polys = [_corners(t) for t in texts]
    for i in range(n):
        for j in range(i + 1, n):
            if _area(_inter(texts[i]["bbox"], texts[j]["bbox"])) > 0 and _polys_overlap(polys[i], polys[j]):
                colliding.update((i, j))
    text_overlap = len(colliding) / n if n else 0.0

    # clipped text: fraction of text area outside the canvas
    clipped = 0
    for t in texts:
        b = t["bbox"]
        inside = _area(_inter(b, [0, 0, W, H]))
        if _area(b) > 0 and inside < 0.98 * _area(b):
            clipped += 1
    clipped_text = min(1.0, clipped / max(1, n) * 3)

    small_text = (sum(1 for t in texts if t["size"] < 8) / n) if n else 0.0

    pts = lay["points"]
    occluded = 0
    for lg in lay["legends"]:
        occluded += sum(1 for x, y in pts if lg[0] <= x <= lg[2] and lg[1] <= y <= lg[3])
    legend_occlusion = min(1.0, occluded / max(1, len(pts)) * 5) if lay["legends"] else 0.0

    # unused canvas: share of the figure outside the box that encloses all axes and text
    boxes = [a["bbox"] for a in lay["axes"]] + [t["bbox"] for t in texts]
    if boxes:
        content = [max(0, min(b[0] for b in boxes)), max(0, min(b[1] for b in boxes)),
                   min(W, max(b[2] for b in boxes)), min(H, max(b[3] for b in boxes))]
        covered = _area(content) / (W * H)
    else:
        covered = 0.0
    whitespace = max(0.0, (0.75 - covered) / 0.75)

    missing = 0
    total = 0
    for ax in lay["axes"]:
        checks = [ax["has_title"]] if ax["is_pie"] else [ax["has_title"], ax["has_xlabel"], ax["has_ylabel"]]
        total += len(checks)
        missing += sum(1 for c in checks if not c)
    missing_labels = missing / total if total else 0.0

    metrics = {
        "text_overlap": round(text_overlap, 4),
        "clipped_text": round(clipped_text, 4),
        "small_text": round(small_text, 4),
        "legend_occlusion": round(legend_occlusion, 4),
        "whitespace": round(min(1.0, whitespace), 4),
        "missing_labels": round(missing_labels, 4),
    }
    score = 100 - sum(WEIGHTS[k] * v for k, v in metrics.items())
    return {"ok": True, "score": round(max(0.0, min(100.0, score)), 2), "metrics": metrics}


def metric_vector(evaluation: dict) -> list[float]:
    return [evaluation["metrics"][k] for k in METRIC_KEYS]
