"""Deterministic tool steps: tool_1, tool_3, tool_5, tool_6, tool_7 (+ keyframe capture)."""
from __future__ import annotations

import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from . import charts, render
from .guidelines import GUIDELINES

# ------------------------------------------------------------- tool_1 compose


def compose_video_request(scripts: list[dict], topic: str) -> dict:
    """[tool_1 compose] scripts -> video_request (Vadoo-style text-to-video payload)."""
    return {
        "service": "vadoo-compatible",
        "title": topic,
        "resolution": f"{render.W}x{render.H}",
        "fps": render.FPS,
        "voice": "system-tts",
        "captions": True,
        "scenes": [
            {"index": i, "duration_s": sc["duration_s"], "voiceover": sc["voiceover"],
             "visual_prompt": sc["visuals"], "guideline_id": sc["guideline_id"],
             "on_screen_title": sc["title"] if i == 0 and sc["guideline_id"] != "striking-number" else None}
            for i, sc in enumerate(scripts)
        ],
    }


def compose_clip_request(scripts: list[dict], scene_index: int, topic: str) -> dict:
    """[tool_1 compose] scripts + clip_scene -> clip_request."""
    sc = scripts[scene_index]
    g = next((x for x in GUIDELINES if x["id"] == sc["guideline_id"]), None)
    return {
        "scene_index": scene_index,
        "duration_s": 5,
        "prompt": f"{sc['visuals']}. Narration: \"{sc['voiceover']}\"",
        "style": f"Opening scene of a data video about '{topic}'. Cinematic guideline: "
                 + (f"{g['name']} — {g['how']}" if g else sc["guideline_id"]),
        "caption": sc["voiceover"],
    }


# ------------------------------------------------------------- tool_3 select


def link_guideline(scripts: list[dict], scene_index: int, references: list[dict]) -> dict:
    """[tool_3 select] scene_focus -> guideline_focus + reference_focus*."""
    sc = scripts[scene_index]
    g = next((x for x in GUIDELINES if x["id"] == sc["guideline_id"]), None)
    refs = [r for r in references if r["guideline_id"] == sc["guideline_id"]]
    return {"scene_focus": scene_index, "guideline_focus": g, "reference_focus": refs}


# ------------------------------------------------------------- tool_7 compose


def gallery_compose(versions: list[dict], video: dict, scripts: list[dict], request: dict) -> dict:
    """[tool_7 compose] add the new video to video_versions (keeps script snapshot)."""
    entry = {
        "id": video["id"], "number": len(versions) + 1, "url": video["url"], "path": video["path"],
        "duration": video["duration"], "scene_times": video["scene_times"],
        "scripts": [dict(s) for s in scripts], "request": request,
        "created": time.strftime("%Y-%m-%d %H:%M:%S"), "assessments": [],
    }
    versions.append(entry)
    return entry


# ------------------------------------------------------------- keyframe capture (human select on the player)


def extract_keyframe(video_path: Path, t: float, out: Path) -> Path:
    frame = render.read_frame_at(video_path, t)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(frame).save(out)
    return out


def scene_range(scene_times: list[list[float]], t: float) -> tuple[float, float]:
    for a, b in scene_times:
        if a <= t < b:
            return a, b
    return (scene_times[-1] if scene_times else [0.0, t + 5])  # type: ignore[return-value]


def mask_overlay_png(frame_path: Path, mask: np.ndarray, out: Path) -> None:
    frame = np.asarray(Image.open(frame_path).convert("RGB")).copy()
    red = np.zeros_like(frame)
    red[..., 0] = 255
    m = mask > 0
    frame[m] = (frame[m] * 0.45 + red[m] * 0.55).astype(np.uint8)
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(frame, cs, -1, (255, 255, 0), 2)
    Image.fromarray(frame).save(out)


def mask_bbox(mask: np.ndarray) -> list[int]:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return [0, 0, 1, 1]
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def mask_color(frame_path: Path, mask: np.ndarray) -> list[int]:
    """Mean colour of the (un-dilated core of the) object, used to stylise chart shapes."""
    frame = np.asarray(Image.open(frame_path).convert("RGB"))
    core = cv2.erode(mask, np.ones((9, 9), np.uint8))
    m = (core if core.any() else mask) > 0
    if not m.any():
        return [242, 201, 76]
    return [int(v) for v in frame[m].mean(axis=0)]


# ------------------------------------------------------------- tool_5 modify (inpainting)


def inpaint_video(video_path: Path, frame_path: Path, mask: np.ndarray, t_start: float, t_end: float, out: Path) -> Path:
    """[tool_5 modify] video + object_mask -> cleaned_video.

    The keyframe is inpainted once (OpenCV Telea); the filled patch is feather-blended
    into every frame from the keyframe to the end of its scene, which keeps the fill
    temporally stable (the stand-in video API holds the camera still after 2 s).
    """
    key = cv2.cvtColor(cv2.imread(str(frame_path)), cv2.COLOR_BGR2RGB)
    filled = cv2.inpaint(key, mask, 7, cv2.INPAINT_TELEA)
    alpha = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), 2.0)
    alpha = np.clip(alpha * 1.4, 0, 1)[..., None]
    meta, frames = render.read_video(video_path)
    fps = meta.get("fps", render.FPS)

    def processed():
        for i, f in enumerate(frames):
            t = i / fps
            if t_start - 1e-6 <= t < t_end:
                yield (f * (1 - alpha) + filled * alpha).astype(np.uint8)
            else:
                yield f

    return render.write_video(processed(), out, size=tuple(meta["size"]), audio_from=video_path)


# ------------------------------------------------------------- tool_6 compose


def _full_chart_box(bbox: list[int], w: int, h: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    cw = int(min(w * 0.6, max(280, bw * 1.1, bh * 1.5)))
    ch = int(cw / 1.5)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left = int(min(max(4, cx - cw / 2), w - cw - 4))
    top = int(min(max(4, cy - ch / 2), h * 0.82 - ch))
    return left, max(4, top), cw, ch


def _overlay_video(video_path: Path, t_start: float, t_end: float, out: Path, frame_fn) -> Path:
    meta, frames = render.read_video(video_path)
    fps = meta.get("fps", render.FPS)

    def processed():
        for i, f in enumerate(frames):
            t = i / fps
            if t_start - 1e-6 <= t < t_end:
                img = Image.fromarray(f).convert("RGBA")
                layer, pos = frame_fn(t - t_start)
                img.alpha_composite(layer, pos)
                yield np.asarray(img.convert("RGB"))
            else:
                yield f

    return render.write_video(processed(), out, size=tuple(meta["size"]), audio_from=video_path)


def compose_full_chart(cleaned: Path, chart_spec: dict, bbox: list[int], t_start: float, t_end: float, out: Path) -> Path:
    """[tool_6 compose] cleaned_video_full + animated_chart -> video_with_chart (axes and labels kept)."""
    left, top, cw, ch = _full_chart_box(bbox, render.W, render.H)
    return _overlay_video(cleaned, t_start, t_end, out,
                          lambda tc: (charts.render_chart_frame(chart_spec, tc, (cw, ch), "full"), (left, top)))


def compose_chart_shape(cleaned: Path, chart_spec: dict, region: dict, bbox: list[int], color: list[int],
                        t_start: float, t_end: float, out: Path) -> Path:
    """[tool_6 compose] cleaned_video_shape + animated_chart + chart_region -> video_with_shape.

    The selected region of the mark-only chart (tinted with the removed object's colour)
    is stretched into the object's bounding box.
    """
    pw, ph = charts.PREVIEW_SIZE
    rx0, ry0 = int(region["x0"] * pw), int(region["y0"] * ph)
    rx1, ry1 = max(rx0 + 2, int(region["x1"] * pw)), max(ry0 + 2, int(region["y1"] * ph))
    x0, y0, x1, y1 = bbox
    tw, th = max(4, x1 - x0), max(4, y1 - y0)
    col = tuple(int(c) for c in color)

    def frame_fn(tc):
        full = charts.render_chart_frame(chart_spec, tc, (pw, ph), "shape", color=col)
        part = full.crop((rx0, ry0, rx1, ry1)).resize((tw, th), Image.LANCZOS)
        return part, (x0, y0)

    return _overlay_video(cleaned, t_start, t_end, out, frame_fn)


def new_id() -> str:
    return uuid.uuid4().hex[:10]
