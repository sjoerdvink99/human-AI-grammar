"""End-to-end tests of all eight processes through the API with model calls stubbed."""
import os
import tempfile

os.environ["SYSTEMX_DATA"] = tempfile.mkdtemp()

import cv2  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import app as appmod, charts, llm, models  # noqa: E402

SCRIPTS = {"scenes": [
    {"title": "City at dawn", "guideline_id": "establishing-shot", "voiceover": "The city wakes up.",
     "visuals": "a city skyline and a car in traffic", "rationale": "sets the place", "duration_s": 4},
    {"title": "The number", "guideline_id": "striking-number", "voiceover": "Half the offices are empty.",
     "visuals": "the number 50% and a building", "rationale": "hook", "duration_s": 4},
]}
CLIP = {"background": {"top": "#000000", "bottom": "#223344"}, "camera": {"zoom_from": 1, "zoom_to": 1.05},
        "objects": [{"kind": "house", "x": 0.5, "y": 0.5, "size": 0.4, "color": "#ff8800", "enter": "pop", "start": 0}]}


def fake_model(role, prompt, **kw):
    if role == "model_1":
        assert "Story topic" in prompt and "establishing-shot" in prompt
        return SCRIPTS
    if role == "model_2":
        return CLIP
    if role == "model_3":
        return {"label": "car", "polygon": [[0, 0], [5, 0], [5, 5]]}  # does not contain the click -> fallback
    raise AssertionError(role)


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(models, "call_model", fake_model)
    return TestClient(appmod.app)


def test_parse_table_and_validation():
    d = charts.parse_table("Year,Value\n2019,6\n2020,35\n2021,28")
    assert d["columns"] == ["Year", "Value"] and d["rows"][1] == ["2020", 35.0]
    d2 = charts.parse_table("a\t1,200\nb\t3,400")
    assert d2["rows"][0][1] == 1200.0
    with pytest.raises(charts.ChartDataError):
        charts.make_spec(charts.parse_table("a,-1\nb,2"), "pie")
    with pytest.raises(charts.ChartDataError):
        charts.parse_table("only one row,1")


def test_script_validation_rejects_unknown_guideline():
    bad = {"scenes": [dict(SCRIPTS["scenes"][0], guideline_id="nope")]}
    with pytest.raises(llm.ModelError):
        models.validate_scripts(bad, [])


def test_extract_json():
    assert llm.extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert llm.extract_json('Sure: {"a": 2} done') == {"a": 2}


def test_all_processes(client):
    # P1 generate scripts -> compose -> execute -> gallery
    s = client.post("/api/scripts/generate", json={"topic": "Remote work", "data_facts": ["50% occupancy"]}).json()
    assert len(s["scripts"]) == 2
    s = client.post("/api/video/render", json={}).json()
    assert len(s["video_versions"]) == 1 and s["video_request"]["scenes"][0]["visual_prompt"]
    v1 = s["video_versions"][0]
    assert v1["scene_times"] == [[0.0, pytest.approx(v1["scene_times"][0][1])], v1["scene_times"][1]]

    # P2 scene focus -> guideline + references
    f = client.get("/api/scenes/1/focus").json()
    assert f["guideline_focus"]["id"] == "striking-number" and len(f["reference_focus"]) == 2

    # P3 assess, modify, regenerate
    client.post("/api/assessment", json={"version_id": v1["id"], "text": "too slow", "kind": "design"})
    edited = s["scripts"]
    edited[0]["visuals"] = "a forest of trees and a factory"
    s = client.post("/api/video/render", json={"scripts": edited}).json()
    assert len(s["video_versions"]) == 2 and s["scripts_version"] == 2
    assert s["video_versions"][0]["assessments"][0]["text"] == "too slow"
    assert s["video_versions"][0]["scripts"][0]["visuals"] != s["video_versions"][1]["scripts"][0]["visuals"]

    # P4 single clip
    s = client.post("/api/clip", json={"scene_index": 0}).json()
    assert s["clips"]["0"]["request"]["duration_s"] == 5

    # P5 animated chart
    r = client.post("/api/chart", json={"text": "Year,Share\n2019,6\n2020,35\n2021,28", "chart_type": "bar"})
    assert r.status_code == 200
    assert client.post("/api/chart", json={"text": "x", "chart_type": "bar"}).status_code == 400

    # P6 full chart replacement (segmentation falls back to flood fill because the stub polygon misses)
    s = client.post("/api/replace/keyframe", json={"mode": "full", "time": 2.5}).json()
    kf = s["replace"]["full"]["keyframe"]
    assert kf["scene_end"] > kf["time"]
    s = client.post("/api/replace/segment", json={"mode": "full", "x": 320, "y": 180}).json()
    assert s["replace"]["full"]["mask"]["source"] in ("model_3", "fallback")
    s = client.post("/api/replace/inpaint", json={"mode": "full"}).json()
    assert s["replace"]["full"]["cleaned"]["url"]
    s = client.post("/api/replace/compose", json={"mode": "full"}).json()
    assert s["replace"]["full"]["result"]["url"].endswith(".mp4")

    # P7 chart shape replacement
    client.post("/api/replace/keyframe", json={"mode": "shape", "time": 2.5})
    client.post("/api/replace/segment", json={"mode": "shape", "x": 320, "y": 180})
    client.post("/api/replace/inpaint", json={"mode": "shape"})
    assert client.post("/api/replace/compose", json={"mode": "shape"}).status_code == 400
    s = client.post("/api/replace/compose", json={"mode": "shape", "region": {"x0": 0, "y0": 0.2, "x1": 0.5, "y1": 1}}).json()
    assert s["replace"]["shape"]["result"]["url"]

    # P8 review an earlier version
    s = client.post("/api/assessment", json={"version_id": v1["id"], "text": "better pacing", "kind": "review"}).json()
    assert s["video_versions"][0]["assessments"][-1]["kind"] == "review"


def test_segment_uses_valid_model_polygon(monkeypatch, tmp_path):
    import numpy as np
    img = np.zeros((360, 640, 3), np.uint8)
    p = tmp_path / "f.png"
    cv2.imwrite(str(p), img)
    monkeypatch.setattr(models, "call_model", lambda *a, **k: {"label": "box", "polygon": [[100, 100], [200, 100], [200, 200], [100, 200]]})
    res = models.segment_object(p, (150, 150))
    assert res["source"] == "model_3" and res["label"] == "box" and res["mask"][150, 150] == 255
