"""FastAPI app wiring the design's eight processes to HTTP endpoints."""
from __future__ import annotations

import threading
import time
from pathlib import Path

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import charts, guidelines, models, tools, video_api
from .llm import ModelError
from .state import MEDIA, ROOT, Store

app = FastAPI(title="System X — opening-scene ideation")
store = Store()
REFS = guidelines.reference_videos(MEDIA)
threading.Thread(target=guidelines.ensure_reference_videos, args=(MEDIA,), daemon=True).start()


def _model_errors(fn):
    try:
        return fn()
    except ModelError as e:
        raise HTTPException(502, f"Model step failed: {e}") from e
    except charts.ChartDataError as e:
        raise HTTPException(400, str(e)) from e


# ------------------------------------------------------------------ general

@app.get("/api/state")
def get_state():
    return store.public()


@app.post("/api/reset")
def reset():
    store.reset()
    return store.public()


@app.get("/api/guidelines")
def get_guidelines():
    """guidelines_1* and reference_videos_1*"""
    return {"guidelines": guidelines.GUIDELINES, "reference_videos": [guidelines.public(r) for r in REFS]}


# ------------------------------------------------------------------ process 1

class GenerateIn(BaseModel):
    topic: str = Field(min_length=1)
    data_facts: list[str] = []


@app.post("/api/scripts/generate")
def generate_scripts(body: GenerateIn):
    """P1 [model_1 generate]~ : topic_1 + data_facts_1* + guidelines_1* -> scripts_1*"""
    facts = [f.strip() for f in body.data_facts if f.strip()]
    scripts = _model_errors(lambda: models.generate_scripts(body.topic.strip(), facts))
    with store.lock:
        store.s.update(topic=body.topic.strip(), data_facts=facts, scripts=scripts,
                       scripts_version=store.s["scripts_version"] + 1, clips={})
        store.save()
    return store.public()


class RenderIn(BaseModel):
    scripts: list[dict] | None = None  # scripts_2 when the creator edited them (P3 human modify)


def _clean_scripts(raw: list[dict]) -> list[dict]:
    out = []
    for sc in raw:
        if sc.get("guideline_id") not in guidelines.GUIDELINE_IDS:
            raise HTTPException(400, f"unknown guideline {sc.get('guideline_id')}")
        if not str(sc.get("voiceover", "")).strip() or not str(sc.get("visuals", "")).strip():
            raise HTTPException(400, "every scene needs voiceover and visuals")
        out.append({"title": str(sc.get("title", "")), "guideline_id": sc["guideline_id"],
                    "voiceover": str(sc["voiceover"]).strip(), "visuals": str(sc["visuals"]).strip(),
                    "rationale": str(sc.get("rationale", "")),
                    "duration_s": max(3.0, min(10.0, float(sc.get("duration_s", 5))))})
    if not out:
        raise HTTPException(400, "no scenes")
    return out


@app.post("/api/video/render")
def render_video(body: RenderIn):
    """P1/P3 [tool_1 compose] -> [tool_2 execute] -> [tool_7 compose]"""
    with store.lock:
        if body.scripts is not None:
            new = _clean_scripts(body.scripts)
            if new != store.s["scripts"]:
                store.s["scripts"] = new
                store.s["scripts_version"] += 1
        scripts = store.s["scripts"]
        topic = store.s["topic"]
    if not scripts:
        raise HTTPException(400, "generate scripts first")
    request = tools.compose_video_request(scripts, topic)                       # tool_1
    vid = tools.new_id()
    path = MEDIA / "videos" / f"{vid}.mp4"
    info = video_api.execute(request, path)                                     # tool_2
    video = {"id": vid, "url": f"/media/videos/{vid}.mp4", "path": str(path), **info}
    with store.lock:
        tools.gallery_compose(store.s["video_versions"], video, scripts, request)  # tool_7
        store.s["video_versions"][-1]["specs"] = info["specs"]
        store.s["video_request"] = request
        store.s["video_id"] = vid
        store.save()
    return store.public()


# ------------------------------------------------------------------ process 2

@app.get("/api/scenes/{index}/focus")
def scene_focus(index: int, guideline_id: str | None = None):
    """P2 [tool_3 select] : scene_focus_1 -> guideline_focus_1 + reference_focus_1*

    `guideline_id` lets the view follow an unsaved edit of the scene's guideline."""
    scripts = [dict(s) for s in store.s["scripts"]]
    if not 0 <= index < len(scripts):
        raise HTTPException(404, "no such scene")
    if guideline_id in guidelines.GUIDELINE_IDS:
        scripts[index]["guideline_id"] = guideline_id
    res = tools.link_guideline(scripts, index, REFS)
    res["reference_focus"] = [guidelines.public(r) for r in res["reference_focus"]]
    return res


# ------------------------------------------------------------------ process 3 / 8 assessments

class AssessIn(BaseModel):
    version_id: str
    text: str = Field(min_length=1)
    kind: str = "design"  # "design" = assessment_1 (P3), "review" = video_assessment_1 (P8)


@app.post("/api/assessment")
def assess(body: AssessIn):
    with store.lock:
        v = store.version(body.version_id)
        if not v:
            raise HTTPException(404, "no such version")
        v["assessments"].append({"kind": body.kind, "text": body.text.strip(),
                                 "scripts_version": store.s["scripts_version"],
                                 "at": time.strftime("%Y-%m-%d %H:%M:%S")})
        store.save()
    return store.public()


# ------------------------------------------------------------------ process 4

class ClipIn(BaseModel):
    scene_index: int


@app.post("/api/clip")
def make_clip(body: ClipIn):
    """P4 clip_scene_1 -> [tool_1 compose] -> clip_request_1 -> [model_2 generate]~ -> clip_1"""
    scripts = store.s["scripts"]
    if not 0 <= body.scene_index < len(scripts):
        raise HTTPException(404, "no such scene")
    request = tools.compose_clip_request(scripts, body.scene_index, store.s["topic"])
    cid = tools.new_id()
    out = MEDIA / "clips" / f"{cid}.mp4"
    res = _model_errors(lambda: models.generate_clip(request, out))
    with store.lock:
        store.s["clips"][str(body.scene_index)] = {"id": cid, "url": f"/media/clips/{cid}.mp4", "request": request,
                                                   "spec": res["spec"], "scene": dict(scripts[body.scene_index])}
        store.save()
    return store.public()


# ------------------------------------------------------------------ process 5

class ChartIn(BaseModel):
    text: str
    chart_type: str
    title: str = ""


@app.post("/api/chart")
def make_chart(body: ChartIn):
    """P5 chart_data_1 + chart_type_1 -> [tool_4 translate] -> animated_chart_1"""
    def run():
        data = charts.parse_table(body.text)
        spec = charts.make_spec(data, body.chart_type, body.title.strip())
        cid = tools.new_id()
        out = MEDIA / "charts" / f"{cid}.mp4"
        charts.render_chart_video(spec, out)
        charts.render_shape_still(spec, MEDIA / "charts" / f"{cid}_shape.png")
        return {"id": cid, "text": body.text, "chart_data": data, "chart_type": body.chart_type, "spec": spec,
                "url": f"/media/charts/{cid}.mp4", "shape_url": f"/media/charts/{cid}_shape.png"}
    chart = _model_errors(run)
    with store.lock:
        store.s["chart"] = chart
        store.s["replace"] = {"full": None, "shape": None}
        store.save()
    return store.public()


# ------------------------------------------------------------------ processes 6 and 7

def _mode(mode: str) -> str:
    if mode not in ("full", "shape"):
        raise HTTPException(400, "mode must be full or shape")
    return mode


class KeyframeIn(BaseModel):
    mode: str
    time: float = Field(ge=0)


@app.post("/api/replace/keyframe")
def replace_keyframe(body: KeyframeIn):
    """P6/P7 [human select] pause the video -> keyframe_full_1 / keyframe_shape_1"""
    mode = _mode(body.mode)
    video = store.current_video()
    if not video:
        raise HTTPException(400, "generate a video first")
    if not store.s.get("chart"):
        raise HTTPException(400, "create an animated chart first")
    t = min(body.time, max(0.0, video["duration"] - 0.05))
    kid = tools.new_id()
    path = MEDIA / "replace" / f"{kid}_key.png"
    tools.extract_keyframe(Path(video["path"]), t, path)
    start, end = tools.scene_range(video["scene_times"], t)
    with store.lock:
        store.s["replace"][mode] = {"id": kid, "video_id": video["id"], "keyframe": {
            "time": round(t, 3), "url": f"/media/replace/{kid}_key.png", "path": str(path), "scene_end": end,
            "scene_start": start}}
        store.save()
    return store.public()


class PointIn(BaseModel):
    mode: str
    x: float
    y: float


@app.post("/api/replace/segment")
def replace_segment(body: PointIn):
    """P6/P7 object_point -> [model_3 extract] -> object_mask"""
    mode = _mode(body.mode)
    r = store.s["replace"].get(mode)
    if not r or "keyframe" not in r:
        raise HTTPException(400, "pick a keyframe first")
    kf = Path(r["keyframe"]["path"])
    res = models.segment_object(kf, (int(body.x), int(body.y)))
    mpath = MEDIA / "replace" / f"{r['id']}_mask.png"
    cv2.imwrite(str(mpath), res["mask"])
    over = MEDIA / "replace" / f"{r['id']}_overlay_{tools.new_id()}.png"
    tools.mask_overlay_png(kf, res["mask"], over)
    with store.lock:
        r["point"] = {"x": body.x, "y": body.y}
        r["mask"] = {"path": str(mpath), "url": f"/media/replace/{over.name}", "label": res["label"],
                     "source": res["source"], "error": res["error"], "polygon": res["polygon"],
                     "bbox": tools.mask_bbox(res["mask"]), "color": tools.mask_color(kf, res["mask"])}
        for k in ("cleaned", "region", "result"):
            r.pop(k, None)
        store.save()
    return store.public()


class ModeIn(BaseModel):
    mode: str


@app.post("/api/replace/inpaint")
def replace_inpaint(body: ModeIn):
    """P6/P7 [tool_5 modify] video + object_mask -> cleaned_video"""
    mode = _mode(body.mode)
    r = store.s["replace"].get(mode)
    if not r or "mask" not in r:
        raise HTTPException(400, "select an object first")
    video = store.version(r["video_id"])
    mask = cv2.imread(r["mask"]["path"], cv2.IMREAD_GRAYSCALE)
    out = MEDIA / "replace" / f"{r['id']}_clean.mp4"
    tools.inpaint_video(Path(video["path"]), Path(r["keyframe"]["path"]), mask,
                        r["keyframe"]["time"], r["keyframe"]["scene_end"], out)
    with store.lock:
        r["cleaned"] = {"url": f"/media/replace/{out.name}?v={tools.new_id()}", "path": str(out)}
        r.pop("result", None)
        store.save()
    return store.public()


class ComposeIn(BaseModel):
    mode: str
    region: dict | None = None  # chart_region_1 {x0,y0,x1,y1} in 0..1 (shape mode only)


@app.post("/api/replace/compose")
def replace_compose(body: ComposeIn):
    """P6/P7 [tool_6 compose] cleaned_video + animated_chart (+ chart_region) -> video_with_chart / video_with_shape"""
    mode = _mode(body.mode)
    r = store.s["replace"].get(mode)
    chart = store.s.get("chart")
    if not r or "cleaned" not in r or not chart:
        raise HTTPException(400, "inpaint the video first")
    cleaned = Path(r["cleaned"]["path"])
    kf = r["keyframe"]
    rid = tools.new_id()
    out = MEDIA / "replace" / f"{r['id']}_{mode}_{rid}.mp4"
    if mode == "full":
        tools.compose_full_chart(cleaned, chart["spec"], r["mask"]["bbox"], kf["time"], kf["scene_end"], out)
    else:
        reg = body.region
        if not reg or not all(k in reg for k in ("x0", "y0", "x1", "y1")):
            raise HTTPException(400, "select a region of the chart")
        reg = {k: float(min(1, max(0, reg[k]))) for k in ("x0", "y0", "x1", "y1")}
        reg = {"x0": min(reg["x0"], reg["x1"]), "x1": max(reg["x0"], reg["x1"]),
               "y0": min(reg["y0"], reg["y1"]), "y1": max(reg["y0"], reg["y1"])}
        if reg["x1"] - reg["x0"] < 0.02 or reg["y1"] - reg["y0"] < 0.02:
            raise HTTPException(400, "the selected chart region is too small")
        r["region"] = reg
        tools.compose_chart_shape(cleaned, chart["spec"], reg, r["mask"]["bbox"], r["mask"]["color"],
                                  kf["time"], kf["scene_end"], out)
    with store.lock:
        r["result"] = {"url": f"/media/replace/{out.name}", "path": str(out)}
        store.save()
    return store.public()


# ------------------------------------------------------------------ static

app.mount("/media", StaticFiles(directory=MEDIA), name="media")
FRONTEND = ROOT / "frontend"


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
