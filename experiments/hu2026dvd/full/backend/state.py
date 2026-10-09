"""Application state, named after the design's representation identifiers."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("SYSTEMX_DATA", ROOT / "data"))
MEDIA = DATA / "media"
STATE_FILE = DATA / "project.json"


def empty() -> dict:
    return {
        "topic": "",                # topic_1
        "data_facts": [],           # data_facts_1*
        "scripts": [],              # scripts_1 / scripts_2 (current version of the scene scripts)
        "scripts_version": 0,
        "video_request": None,      # video_request_1 / _2
        "video_id": None,           # video_1: id of the current entry in video_versions
        "video_versions": [],       # video_versions_1*
        "clips": {},                # clip_1 per scene index (with clip_request_1)
        "chart": None,              # chart_data_1 + chart_type_1 + animated_chart_1
        "replace": {"full": None, "shape": None},  # processes 6 and 7
    }


class Store:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        DATA.mkdir(parents=True, exist_ok=True)
        MEDIA.mkdir(parents=True, exist_ok=True)
        self.s = empty()
        if STATE_FILE.exists():
            try:
                self.s.update(json.loads(STATE_FILE.read_text()))
            except json.JSONDecodeError:
                pass

    def save(self) -> None:
        with self.lock:
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.s, indent=1))
            tmp.replace(STATE_FILE)

    def reset(self) -> None:
        with self.lock:
            self.s = empty()
            self.save()

    def current_video(self) -> dict | None:
        return next((v for v in self.s["video_versions"] if v["id"] == self.s["video_id"]), None)

    def version(self, vid: str) -> dict | None:
        return next((v for v in self.s["video_versions"] if v["id"] == vid), None)

    def public(self) -> dict:
        def strip(o):
            if isinstance(o, dict):
                return {k: strip(v) for k, v in o.items() if k not in ("path",) and not k.startswith("_")}
            if isinstance(o, list):
                return [strip(x) for x in o]
            return o
        return strip(self.s)
