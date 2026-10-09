"""tool_4 — animated chart templates (line, bar, pie) driven by pasted tabular data."""
from __future__ import annotations

import csv
import io
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from . import render
from .render import ease_out, font

CHART_TYPES = ("line", "bar", "pie")
ANIM = 2.5  # seconds for the build-up animation
SERIES_COLORS = [(47, 128, 237), (235, 87, 87), (39, 174, 96), (242, 153, 74), (155, 81, 224), (86, 204, 242)]
PREVIEW_SIZE = (480, 320)


class ChartDataError(ValueError):
    pass


def _num(s: str) -> float | None:
    s = s.strip().replace("−", "-")
    s = re.sub(r"[%$€£\s]", "", s)
    if re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", s):
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def parse_table(text: str) -> dict:
    """chart_data: parse pasted CSV/TSV into {columns, rows}; first column = labels."""
    text = text.strip()
    if not text:
        raise ChartDataError("Paste a table first (first column labels, then numeric columns).")
    first = text.splitlines()[0]
    delim = "\t" if "\t" in first else (";" if first.count(";") > first.count(",") else ",")
    if delim == "," and "," not in first and re.search(r"\s{2,}|\s", first):
        rows = [re.split(r"\s{2,}|\s+(?=[-\d$€£])", ln.strip()) for ln in text.splitlines() if ln.strip()]
    else:
        rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ChartDataError("Need at least two rows.")
    has_header = len(rows[0]) > 1 and _num(rows[0][1]) is None
    header = [c.strip() for c in rows[0]] if has_header else ["label"] + [f"value {i}" for i in range(1, len(rows[0]))]
    body = rows[1:] if has_header else rows
    ncols = len(header)
    out_rows = []
    for r in body:
        r = (r + [""] * ncols)[:ncols]
        vals = [_num(c) for c in r[1:]]
        if vals and all(v is None for v in vals):
            continue
        out_rows.append([r[0].strip()] + [v if v is not None else 0.0 for v in vals])
    if len(out_rows) < 2 or ncols < 2:
        raise ChartDataError("Need a label column and at least one numeric column with two or more rows.")
    if len(out_rows) > 40:
        raise ChartDataError("At most 40 rows are supported.")
    return {"columns": header, "rows": out_rows}


def make_spec(chart_data: dict, chart_type: str, title: str = "") -> dict:
    if chart_type not in CHART_TYPES:
        raise ChartDataError(f"chart type must be one of {CHART_TYPES}")
    if chart_type == "pie" and any(r[1] < 0 for r in chart_data["rows"]):
        raise ChartDataError("Pie charts need non-negative values.")
    if chart_type == "pie" and sum(r[1] for r in chart_data["rows"]) <= 0:
        raise ChartDataError("Pie values must sum to more than zero.")
    return {"type": chart_type, "columns": chart_data["columns"], "rows": chart_data["rows"],
            "title": title or (chart_data["columns"][1] if len(chart_data["columns"]) > 1 else "")}


def _fmt(v: float) -> str:
    if abs(v) >= 1e9:
        return f"{v/1e9:.1f}B"
    if abs(v) >= 1e6:
        return f"{v/1e6:.1f}M"
    if abs(v) >= 1e4:
        return f"{v/1e3:.0f}k"
    return f"{v:.0f}" if float(v).is_integer() else f"{v:.1f}"


def render_chart_frame(spec: dict, t: float, size: tuple[int, int], mode: str = "full",
                       color: tuple[int, int, int] | None = None) -> Image.Image:
    """RGBA chart frame. mode='full' has panel, axes and labels; mode='shape' only the marks."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    full = mode == "full"
    p = ease_out(t / ANIM)
    sc = max(0.72, min(w / 480, h / 320))
    if full:
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(10 * sc), fill=(255, 255, 255, 235))
        d.text((w / 2, 8 * sc), spec.get("title", ""), font=font(int(15 * sc), True), fill=(30, 30, 30), anchor="ma")
    rows = spec["rows"]
    ncols = len(spec["columns"]) - 1
    palette = [color] if color else SERIES_COLORS

    if spec["type"] == "pie":
        cx, cy = (w * 0.4, h * 0.55) if full else (w / 2, h / 2)
        r = min(w, h) * (0.36 if full else 0.48)
        total = sum(max(0, row[1]) for row in rows)
        a0 = -90.0
        sweep_total = 360 * p
        for i, row in enumerate(rows):
            ang = 360 * max(0, row[1]) / total
            a1 = min(a0 + ang, -90 + sweep_total)
            if a1 > a0:
                col = palette[i % len(palette)] if not color else render._shade(color, 0.7 + 0.6 * (i % 4) / 3)
                d.pieslice([cx - r, cy - r, cx + r, cy + r], a0, a1, fill=col + (255,), outline=(255, 255, 255, 255) if full else None, width=2)
            a0 += ang
        if full:
            f = font(int(12 * sc))
            for i, row in enumerate(rows[:10]):
                y = h * 0.22 + i * 18 * sc
                col = palette[i % len(palette)]
                d.rectangle([w * 0.75, y, w * 0.75 + 10 * sc, y + 10 * sc], fill=col + (255,))
                pct = 100 * max(0, row[1]) / total
                d.text((w * 0.75 + 14 * sc, y - 2), f"{row[0]} {pct:.0f}%", font=f, fill=(40, 40, 40))
        return img

    vals = [v for row in rows for v in row[1:]]
    vmin, vmax = min(0.0, min(vals)), max(vals)
    if vmax == vmin:
        vmax = vmin + 1
    if full:
        vmax += (vmax - vmin) * 0.1  # headroom for value labels
    left, right, top, bottom = (48 * sc, w - 16 * sc, 34 * sc, h - 34 * sc) if full else (2, w - 2, 2, h - 2)

    def ymap(v):
        return bottom - (v - vmin) / (vmax - vmin) * (bottom - top)

    if full:
        f = font(int(11 * sc))
        for k in range(5):
            v = vmin + (vmax - vmin) * k / 4
            y = ymap(v)
            d.line([left, y, right, y], fill=(225, 225, 225), width=1)
            d.text((left - 6, y), _fmt(v), font=f, fill=(90, 90, 90), anchor="rm")
        d.line([left, top, left, bottom], fill=(60, 60, 60), width=2)
        d.line([left, ymap(max(vmin, 0)), right, ymap(max(vmin, 0))], fill=(60, 60, 60), width=2)
        step = max(1, math.ceil(len(rows) / 10))
        n = len(rows)
        for i, row in enumerate(rows):
            if i % step:
                continue
            x = left + (i + 0.5) * (right - left) / n if spec["type"] == "bar" else left + i * (right - left) / max(1, n - 1)
            d.text((x, bottom + 5), str(row[0])[:10], font=f, fill=(70, 70, 70), anchor="ma")
        if ncols > 1:
            for j in range(ncols):
                d.rectangle([right - 110 * sc, top + j * 14 * sc, right - 102 * sc, top + j * 14 * sc + 8 * sc], fill=palette[j % len(palette)] + (255,))
                d.text((right - 98 * sc, top + j * 14 * sc - 2), spec["columns"][j + 1][:14], font=f, fill=(60, 60, 60))

    n = len(rows)
    if spec["type"] == "bar":
        group = (right - left) / n
        bw = group * 0.75 / ncols
        for i, row in enumerate(rows):
            stagger = ease_out((t - i * 0.08) / ANIM) if t < ANIM + n * 0.08 else 1.0
            for j in range(ncols):
                v = row[1 + j]
                x0 = left + i * group + group * 0.125 + j * bw
                y0 = ymap(max(vmin, 0))
                y1 = y0 + (ymap(v) - y0) * stagger
                col = palette[j % len(palette)]
                d.rectangle([x0, min(y0, y1), x0 + bw - 1, max(y0, y1)], fill=col + (255,))
                if full and stagger > 0.95 and n <= 12:
                    d.text((x0 + bw / 2, min(y0, y1) - 3), _fmt(v), font=font(int(10 * sc)), fill=(50, 50, 50), anchor="mb")
    else:  # line
        for j in range(ncols):
            pts = [(left + i * (right - left) / max(1, n - 1), ymap(row[1 + j])) for i, row in enumerate(rows)]
            reveal = p * (n - 1)
            shown = pts[: int(reveal) + 1]
            k = int(reveal)
            if k < n - 1:
                fr = reveal - k
                shown.append((pts[k][0] + (pts[k + 1][0] - pts[k][0]) * fr, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * fr))
            col = palette[j % len(palette)]
            if len(shown) > 1:
                d.line(shown, fill=col + (255,), width=max(3, int(4 * sc)), joint="curve")
            if not full and len(shown) > 1:  # shape mode: filled area under the line reads as a shape
                poly = shown + [(shown[-1][0], bottom), (shown[0][0], bottom)]
                d.polygon(poly, fill=col + (150,))
            rr = 3.5 * sc
            for x, y in shown[: k + 1]:
                d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (255,))
    return img


def render_chart_video(spec: dict, out: Path, duration: float = 4.0) -> Path:
    """[tool_4 translate] -> animated_chart preview mp4."""
    w, h = PREVIEW_SIZE
    bg = Image.new("RGBA", (w, h), (236, 239, 243, 255))

    def frames():
        for i in range(int(duration * render.FPS)):
            fr = bg.copy()
            ch = render_chart_frame(spec, i / render.FPS, (w - 20, h - 20))
            fr.alpha_composite(ch, (10, 10))
            yield np.asarray(fr.convert("RGB"))

    return render.write_video(frames(), out, size=(w, h))


def render_shape_still(spec: dict, out: Path, color=None) -> Path:
    """Final frame of the chart in shape mode, on which the user selects chart_region."""
    img = render_chart_frame(spec, ANIM + 5, PREVIEW_SIZE, mode="shape", color=color)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out
