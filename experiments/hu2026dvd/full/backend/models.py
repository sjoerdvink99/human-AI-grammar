"""Model steps of the design. Each builds one prompt from the representations in the
preceding state, calls `llm.call_model`, and validates the typed output."""
from __future__ import annotations

import re
from pathlib import Path

import cv2
import numpy as np

from . import render
from .guidelines import GUIDELINE_IDS, GUIDELINES
from .llm import ModelError, call_model

# ------------------------------------------------------------- model_1 generate (scripts)

SCRIPT_SYSTEM = (
    "You are a screenwriting model specialised (as if fine-tuned) on opening scenes of professional data videos. "
    "You write short, cinematic opening sequences for data stories and always ground each scene in one cinematic "
    "guideline from the list you are given. You only use the data facts you are given; never invent numbers."
)

SCRIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "scenes": {
            "type": "array", "minItems": 2, "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "guideline_id": {"type": "string", "enum": GUIDELINE_IDS},
                    "voiceover": {"type": "string"},
                    "visuals": {"type": "string"},
                    "rationale": {"type": "string"},
                    "duration_s": {"type": "number"},
                },
                "required": ["title", "guideline_id", "voiceover", "visuals", "rationale", "duration_s"],
            },
        }
    },
    "required": ["scenes"],
}


def _script_prompt(topic: str, data_facts: list[str], guidelines: list[dict]) -> str:
    g = "\n".join(f"- {x['id']}: {x['name']} — {x['principle']} ({x['how']})" for x in guidelines)
    f = "\n".join(f"{i+1}. {x}" for i, x in enumerate(data_facts)) or "(none given)"
    return f"""Write the opening scenes (3 to 4 scenes, about 20-30 seconds total) of a data video.

Story topic: {topic}

Selected data facts (use only these numbers):
{f}

Cinematic guidelines for opening scenes:
{g}

For every scene give:
- title: a short working title of the shot
- guideline_id: the id of the one guideline the scene follows
- voiceover: the narration, one or two short sentences (spoken in about 4-8 seconds)
- visuals: what is on screen, as concrete nameable objects and setting (e.g. "a city skyline at dawn, a crowd of commuters, a car in traffic"); mention the number if it is shown on screen
- rationale: one sentence on why this guideline fits this moment of the opening
- duration_s: 4 to 8

Vary guidelines across scenes. Return JSON only."""


def validate_scripts(data: dict, data_facts: list[str]) -> list[dict]:
    scenes = data.get("scenes") if isinstance(data, dict) else None
    if not isinstance(scenes, list) or not scenes:
        raise ModelError("model_1 returned no scenes")
    out = []
    for sc in scenes[:5]:
        gid = str(sc.get("guideline_id", "")).strip()
        if gid not in GUIDELINE_IDS:
            raise ModelError(f"model_1 used unknown guideline '{gid}'")
        vo = str(sc.get("voiceover", "")).strip()
        vis = str(sc.get("visuals", "")).strip()
        if not vo or not vis:
            raise ModelError("model_1 returned a scene without voiceover or visuals")
        try:
            dur = float(sc.get("duration_s", 5))
        except (TypeError, ValueError):
            dur = 5.0
        out.append({
            "title": str(sc.get("title", "")).strip() or "Untitled scene",
            "guideline_id": gid,
            "voiceover": vo,
            "visuals": vis,
            "rationale": str(sc.get("rationale", "")).strip(),
            "duration_s": max(3.0, min(10.0, dur)),
        })
    return out


def generate_scripts(topic: str, data_facts: list[str], guidelines: list[dict] = GUIDELINES) -> list[dict]:
    """[model_1 generate]~ : topic + data_facts + guidelines -> scripts."""
    prompt = _script_prompt(topic, data_facts, guidelines)
    last: Exception | None = None
    for _ in range(2):
        try:
            data = call_model("model_1", prompt, system=SCRIPT_SYSTEM, schema=SCRIPT_SCHEMA)
            return validate_scripts(data, data_facts)
        except ModelError as e:
            last = e
    raise last  # type: ignore[misc]


# ------------------------------------------------------------- model_2 generate (5-s clip)

CLIP_SYSTEM = (
    "You are a text-to-video model. You turn a scene request into a five-second animated shot, expressed as a "
    "structured scene specification that a renderer draws exactly."
)

CLIP_SCHEMA = {
    "type": "object",
    "properties": {
        "background": {"type": "object", "properties": {"top": {"type": "string"}, "bottom": {"type": "string"}},
                       "required": ["top", "bottom"]},
        "ground": {"type": ["string", "null"]},
        "camera": {"type": "object", "properties": {"zoom_from": {"type": "number"}, "zoom_to": {"type": "number"}},
                   "required": ["zoom_from", "zoom_to"]},
        "title": {"type": ["string", "null"]},
        "objects": {
            "type": "array", "minItems": 1, "maxItems": 6,
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": render.KINDS},
                    "x": {"type": "number"}, "y": {"type": "number"}, "size": {"type": "number"},
                    "color": {"type": "string"},
                    "enter": {"type": "string", "enum": render.ENTERS},
                    "start": {"type": "number"},
                    "label": {"type": ["string", "null"]},
                },
                "required": ["kind", "x", "y", "size", "color", "enter", "start"],
            },
        },
    },
    "required": ["background", "camera", "objects"],
}


def _clip_prompt(clip_request: dict) -> str:
    return f"""Generate a {clip_request['duration_s']}-second shot for this scene request.

Prompt: {clip_request['prompt']}
Style: {clip_request.get('style', '')}

Available object kinds: {', '.join(render.KINDS)}.
Coordinates x, y are the object centre in 0..1 of a 16:9 frame (y grows downward); size is 0.05..0.6 of frame height.
"number" shows its label as a large counting-up figure. enter is the entrance animation; start is when it begins (0..3 s).
Colours are #rrggbb. Use a background gradient and optional ground colour that suit the mood. Camera zoom between 1.0 and 1.1.
Keep the bottom 18% of the frame free (captions). Keep objects from overlapping. Return JSON only."""


def _hex(c, default):
    return c if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) else default


def validate_clip_spec(spec: dict, caption: str) -> dict:
    objs = []
    for o in (spec.get("objects") or [])[:6]:
        if o.get("kind") not in render.KINDS:
            continue
        objs.append({
            "kind": o["kind"],
            "x": min(0.95, max(0.05, float(o.get("x", 0.5)))),
            "y": min(0.8, max(0.08, float(o.get("y", 0.5)))),
            "size": min(0.6, max(0.05, float(o.get("size", 0.3)))),
            "color": _hex(o.get("color"), "#f2c94c"),
            "enter": o.get("enter") if o.get("enter") in render.ENTERS else "fade",
            "start": min(3.0, max(0.0, float(o.get("start", 0)))),
            "label": (str(o["label"])[:24] if o.get("label") else None),
        })
    if not objs:
        raise ModelError("model_2 returned no drawable objects")
    bg = spec.get("background") or {}
    cam = spec.get("camera") or {}
    return {
        "background": {"top": _hex(bg.get("top"), "#0b1d3a"), "bottom": _hex(bg.get("bottom"), "#1e4d7b")},
        "ground": _hex(spec.get("ground"), None),
        "camera": {"zoom_from": min(1.1, max(1.0, float(cam.get("zoom_from", 1.0)))),
                   "zoom_to": min(1.1, max(1.0, float(cam.get("zoom_to", 1.0))))},
        "title": (str(spec["title"])[:60] if spec.get("title") else None),
        "caption": caption,
        "objects": objs,
    }


def generate_clip(clip_request: dict, out: Path) -> dict:
    """[model_2 generate]~ : clip_request -> clip (5-s mp4)."""
    prompt = _clip_prompt(clip_request)
    last: Exception | None = None
    for _ in range(2):
        try:
            raw = call_model("model_2", prompt, system=CLIP_SYSTEM, schema=CLIP_SCHEMA)
            spec = validate_clip_spec(raw, clip_request.get("caption", ""))
            break
        except (ModelError, TypeError, ValueError) as e:
            last = e
    else:
        raise last  # type: ignore[misc]
    render.write_video(render.scene_frames(spec, float(clip_request["duration_s"])), out)
    return {"spec": spec}


# ------------------------------------------------------------- model_3 extract (segmentation)

SEG_SYSTEM = (
    "You are an object segmentation model. Given an image and a click point, you return the outline polygon of "
    "the single object under the click, in pixel coordinates."
)
SEG_SCHEMA = {
    "type": "object",
    "properties": {
        "label": {"type": "string"},
        "polygon": {"type": "array", "minItems": 3, "maxItems": 64,
                    "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}},
    },
    "required": ["label", "polygon"],
}
MASK_DILATE = 9


def _flood_mask(frame: np.ndarray, x: int, y: int) -> np.ndarray:
    h, w = frame.shape[:2]
    mask = np.zeros((h + 2, w + 2), np.uint8)
    img = frame.copy()
    cv2.floodFill(img, mask, (x, y), (0, 0, 0), loDiff=(18, 18, 18), upDiff=(18, 18, 18),
                  flags=4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8))
    m = mask[1:-1, 1:-1]
    if m.sum() / 255 > 0.4 * h * w:  # we filled the background, not an object
        m = np.zeros((h, w), np.uint8)
        cv2.circle(m, (x, y), 30, 255, -1)
    return m


def segment_object(frame_path: Path, point: tuple[int, int]) -> dict:
    """[model_3 extract] : keyframe + object_point -> object_mask.

    Returns {label, polygon, mask (uint8 HxW), source}. The polygon must contain the
    clicked point; otherwise a deterministic colour flood fill from the click is used.
    """
    frame = cv2.cvtColor(cv2.imread(str(frame_path)), cv2.COLOR_BGR2RGB)
    h, w = frame.shape[:2]
    x, y = int(point[0]), int(point[1])
    prompt = (f"Use the Read tool to open the image file {Path(frame_path).resolve()} . It is {w}x{h} pixels "
              f"(origin top-left). The user clicked at pixel ({x}, {y}). Identify the single object under that point "
              f"and return its label and an outline polygon (8-40 points, pixel coordinates, tracing the object's "
              f"visible boundary tightly). Return JSON only.")
    label, polygon, source, error = "object", None, "model_3", None
    try:
        raw = call_model("model_3", prompt, system=SEG_SYSTEM, schema=SEG_SCHEMA, image_paths=[frame_path], timeout=240)
        pts = np.array([[float(p[0]), float(p[1])] for p in raw.get("polygon", [])], dtype=np.float32)
        if len(pts) >= 3:
            pts[:, 0] = pts[:, 0].clip(0, w - 1)
            pts[:, 1] = pts[:, 1].clip(0, h - 1)
            if cv2.pointPolygonTest(pts.reshape(-1, 1, 2), (float(x), float(y)), True) >= -12:
                polygon = pts
                label = str(raw.get("label") or "object")[:40]
            else:
                error = "model polygon did not contain the clicked point"
    except (ModelError, TypeError, ValueError) as e:
        error = str(e)
    if polygon is not None:
        mask = np.zeros((h, w), np.uint8)
        cv2.fillPoly(mask, [polygon.astype(np.int32)], 255)
    else:
        mask = _flood_mask(frame, x, y)
        source = "fallback"
        cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        polygon = max(cs, key=cv2.contourArea).reshape(-1, 2).astype(np.float32) if cs else np.zeros((0, 2))
    mask = cv2.dilate(mask, np.ones((MASK_DILATE, MASK_DILATE), np.uint8))
    return {"label": label, "polygon": polygon.round(1).tolist(), "mask": mask, "source": source, "error": error}
