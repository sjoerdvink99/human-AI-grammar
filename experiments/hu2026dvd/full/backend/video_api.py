"""tool_2 — the video generation API.

The design names Vadoo as the external text-to-video service. No key is available, so
`execute()` is a deterministic local stand-in with the same contract: it takes a
`video_request` (scripts packaged by tool_1) and returns a rendered video. Visual prompts
are turned into scene specs by keyword matching. Replace `execute()` to call a real
service.
"""
from __future__ import annotations

import re
import zlib
from pathlib import Path

from . import render

# keyword regex -> (kind, colour)
PROPS: list[tuple[str, str, str]] = [
    (r"\b(globe|earth|world|planet|global|countr(y|ies)|map)\b", "globe", "#3a7bd5"),
    (r"\b(skyline|city|cities|urban|downtown|metropol\w*)\b", "skyline", "#5b6b8c"),
    (r"\b(building|tower|office|skyscraper|hospital|school)s?\b", "building", "#7d8aa6"),
    (r"\b(crowd|people|population|citizens|workers|students|families)\b", "crowd", "#f2b880"),
    (r"\b(person|man|woman|child|kid|worker|student|patient|farmer|individual|human|someone)\b", "person", "#f2b880"),
    (r"\b(tree|forest|trees|wood|jungle|deforest\w*)\b", "tree", "#3f9b4f"),
    (r"\b(leaf|leaves|plant|crop|green)\b", "leaf", "#55b05a"),
    (r"\b(sun|heat|hot|temperature|warming|summer|sunlight)\b", "sun", "#ffc93c"),
    (r"\b(ice|glacier|arctic|polar|melt\w*|iceberg)\b", "ice", "#d8f0ff"),
    (r"\b(ocean|sea|water|flood\w*|wave|river|tide)s?\b", "wave", "#2f80ed"),
    (r"\b(rain|drop|droplet|drought|drink\w*)s?\b", "drop", "#56ccf2"),
    (r"\b(cloud|sky|weather|storm|air|pollution|smog)s?\b", "cloud", "#e6eef5"),
    (r"\b(coin|money|dollar|cost|price|income|wage|salary|budget|debt|economy|spending)s?\b", "coin", "#f2c94c"),
    (r"\b(car|van|truck|bus|traffic|vehicle|road|commute|driving|ev)s?\b", "car", "#eb5757"),
    (r"\b(house|home|housing|rent|neighbou?rhood)s?\b", "house", "#e0a96d"),
    (r"\b(factory|industry|industrial|emission|carbon|co2|plant)s?\b", "factory", "#8a8f99"),
    (r"\b(clock|time|hour|year|decade|calendar|countdown|timeline)s?\b", "clock", "#bb6bd9"),
    (r"\b(phone|smartphone|mobile|screen|app|internet|online)s?\b", "phone", "#56ccf2"),
    (r"\b(heart|health|love|disease|medical)s?\b", "heart", "#eb5757"),
    (r"\b(chart|graph|bar|statistic|data|trend|growth)s?\b", "bars", "#6fcf97"),
    (r"\b(arrow|rise|rising|increase|grow\w*|up)\b", "arrow", "#27ae60"),
]

PALETTES = [
    ("#0b1d3a", "#1e4d7b"), ("#1a1a2e", "#4b3f72"), ("#0f3443", "#34e89e"),
    ("#232526", "#414345"), ("#3a1c71", "#d76d77"), ("#16222a", "#3a6073"),
    ("#2c3e50", "#4ca1af"), ("#42275a", "#734b6d"),
]

GUIDELINE_STYLE = {
    "establishing-shot": {"camera": (1.08, 1.0), "enter": "fade"},
    "striking-number": {"camera": (1.0, 1.04), "enter": "pop"},
    "provocative-question": {"camera": (1.0, 1.03), "enter": "fade"},
    "human-scale": {"camera": (1.0, 1.05), "enter": "rise"},
    "contrast": {"camera": (1.0, 1.0), "enter": "slide"},
    "visual-metaphor": {"camera": (1.0, 1.05), "enter": "grow"},
    "zoom-in-detail": {"camera": (1.0, 1.08), "enter": "pop"},
    "time-progression": {"camera": (1.0, 1.03), "enter": "slide"},
}

NUMBER_RE = re.compile(r"[$€£]?\d[\d,]*\.?\d*\s?(%|percent|million|billion|thousand|k|x)?", re.I)


def _seed(text: str) -> int:
    return zlib.crc32(text.encode("utf-8"))


def build_spec(visual_prompt: str, *, title: str | None = None, caption: str | None = None,
               guideline_id: str | None = None, seed_text: str = "") -> dict:
    """Deterministically map a visual description to a scene spec."""
    text = visual_prompt.lower()
    found: list[tuple[int, str, str]] = []
    for pattern, kind, color in PROPS:
        m = re.search(pattern, text)
        if m and kind not in {k for _, k, _ in found}:
            found.append((m.start(), kind, color))
    found.sort()
    kinds = [(k, c) for _, k, c in found][:3]

    style = GUIDELINE_STYLE.get(guideline_id or "", {"camera": (1.0, 1.04), "enter": "fade"})
    number = NUMBER_RE.search(visual_prompt)
    objects: list[dict] = []
    if number and (guideline_id == "striking-number" or not kinds):
        objects.append({"kind": "number", "x": 0.5, "y": 0.42, "size": 0.32, "color": "#ffffff",
                        "label": number.group(0).strip(), "enter": "pop", "start": 0.2})
        kinds = kinds[:2]
        slots = {1: [(0.18, 0.62)], 2: [(0.15, 0.62), (0.85, 0.62)]}
        sizes = 0.24
    else:
        slots = {1: [(0.5, 0.5)], 2: [(0.32, 0.5), (0.68, 0.5)], 3: [(0.2, 0.52), (0.5, 0.48), (0.8, 0.52)]}
        sizes = {1: 0.42, 2: 0.36, 3: 0.3}.get(len(kinds), 0.3)
    if not kinds and not objects:
        kinds = [("bars", "#6fcf97")]
        slots = {1: [(0.5, 0.5)]}
        sizes = 0.42
    for i, (kind, color) in enumerate(kinds):
        x, y = slots[len(kinds)][i]
        objects.append({"kind": kind, "x": x, "y": y, "size": sizes, "color": color,
                        "enter": style["enter"], "start": round(0.3 + 0.4 * i, 2)})
    top, bottom = PALETTES[_seed(seed_text + visual_prompt) % len(PALETTES)]
    z0, z1 = style["camera"]
    if guideline_id == "provocative-question" and not title:
        q = re.search(r"([^.?!]*\?)", caption or "")
        title = q.group(1).strip() if q else None
    return {
        "background": {"top": top, "bottom": bottom},
        "camera": {"zoom_from": z0, "zoom_to": z1},
        "title": title,
        "caption": caption,
        "objects": objects,
    }


def execute(video_request: dict, out_path: Path) -> dict:
    """[tool_2 execute]: render the requested scenes into one demo video."""
    scenes = []
    for sc in video_request["scenes"]:
        spec = build_spec(sc["visual_prompt"], title=sc.get("on_screen_title"), caption=sc.get("voiceover"),
                          guideline_id=sc.get("guideline_id"), seed_text=video_request.get("title", ""))
        scenes.append({"spec": spec, "duration_s": sc.get("duration_s", 5), "voiceover": sc.get("voiceover", "")})
    info = render.render_scenes_to_video(scenes, out_path)
    info["specs"] = [s["spec"] for s in scenes]
    return info
