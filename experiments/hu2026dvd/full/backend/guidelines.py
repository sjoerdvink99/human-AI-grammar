"""guidelines_1 and reference_videos_1.

Cinematic guidelines for opening scenes of data videos, each with illustrative
reference clips. No professionally produced footage is bundled, so each reference is a
short locally rendered re-staging of a typical professional opening, with a caption
describing the technique.
"""
from __future__ import annotations

import threading
from pathlib import Path

from . import render, video_api

GUIDELINES: list[dict] = [
    {"id": "establishing-shot", "name": "Establish the setting",
     "principle": "Open on a wide view of the place or world the data is about before any number appears.",
     "how": "Wide shot, slow pull-back, ambient voiceover that names the place and stakes."},
    {"id": "striking-number", "name": "Lead with a striking number",
     "principle": "Reveal one surprising figure large on screen to create immediate curiosity.",
     "how": "Count-up animation of a single number, minimal background, voiceover that frames why it matters."},
    {"id": "provocative-question", "name": "Pose a question",
     "principle": "Start with a question the data will answer, so viewers watch to find out.",
     "how": "Question as on-screen title, sparse visuals, pause before the answer."},
    {"id": "human-scale", "name": "Anchor in a human scale",
     "principle": "Introduce a person or everyday object so abstract quantities become relatable.",
     "how": "Single character rises into frame; the data is told through their situation."},
    {"id": "contrast", "name": "Juxtapose a contrast",
     "principle": "Place two states side by side (before/after, here/there) so the difference is the story.",
     "how": "Split composition, elements slide in from one side, voiceover names both sides."},
    {"id": "visual-metaphor", "name": "Use a visual metaphor",
     "principle": "Show a physical object whose behaviour mirrors the data (rising water, melting ice).",
     "how": "One central object that grows, melts, or fills while the voiceover gives the figure."},
    {"id": "zoom-in-detail", "name": "Zoom from the big picture to a detail",
     "principle": "Move from the overview to a single instance to connect scale and specifics.",
     "how": "Push-in camera move ending on one highlighted element."},
    {"id": "time-progression", "name": "Show change over time",
     "principle": "Compress time so viewers feel a trend unfold.",
     "how": "Clock or calendar device, elements sliding in sequence, years in voiceover."},
]
GUIDELINE_IDS = [g["id"] for g in GUIDELINES]

# (guideline_id, caption, visual description, voiceover)
_REFERENCES = [
    ("establishing-shot", "Documentary opening: dawn over a city skyline before any statistic", "a city skyline under the morning sun", "Every morning, this city wakes up."),
    ("establishing-shot", "News explainer: the globe turns, then settles on one region", "the globe with clouds drifting", "Across the planet, something is shifting."),
    ("striking-number", "Explainer cold open: a single figure counts up on black", "the number 8,000,000 on a dark background", "Eight million. That's the number we start with."),
    ("striking-number", "Sports analytics intro: one percentage fills the screen", "a big 73% with a rising arrow", "Seventy-three percent."),
    ("provocative-question", "Science channel intro: a question hangs on screen", "a clock and a question about time", "How long would it take you to notice?"),
    ("provocative-question", "Economics piece: a question over a single coin", "a coin on a dark background", "Where does your money actually go?"),
    ("human-scale", "Health feature: one person stands in for millions", "a person standing alone", "Meet one of the millions affected."),
    ("human-scale", "Commuting story: a person next to a car", "a worker next to a car in traffic", "This is her commute, every single day."),
    ("contrast", "Climate piece: forest on the left, factory on the right", "a forest tree and a factory with emissions", "Then, and now."),
    ("contrast", "Housing feature: house and coin side by side", "a house and money", "Wages on one side. Rent on the other."),
    ("visual-metaphor", "Climate explainer: an ice block that melts as the voiceover speaks", "melting ice in the ocean", "Imagine this ice is our margin for error."),
    ("visual-metaphor", "Water feature: a single drop that represents a reservoir", "one water drop", "Every drop counts."),
    ("zoom-in-detail", "Urban data story: push in from skyline to one building", "a city skyline with one building", "Zoom in, and one building tells the story."),
    ("zoom-in-detail", "Population piece: from crowd to one person", "a crowd of people", "Out of all these people, focus on one."),
    ("time-progression", "Historical explainer: a clock spins as bars grow", "a clock and a growing bar chart over decades", "Over five decades, the trend only went one way."),
    ("time-progression", "Tech story: a phone and a rising arrow over the years", "a phone and an arrow rising each year", "In ten years, everything changed."),
]


def reference_videos(media_dir: Path) -> list[dict]:
    out = []
    for i, (gid, caption, visual, vo) in enumerate(_REFERENCES):
        out.append({"id": f"ref{i}", "guideline_id": gid, "caption": caption,
                    "url": f"/media/refs/ref{i}.mp4", "path": str(media_dir / "refs" / f"ref{i}.mp4"),
                    "_visual": visual, "_voiceover": vo})
    return out


_lock = threading.Lock()


def ensure_reference_videos(media_dir: Path) -> None:
    """Render the illustrative reference clips once (silent, 4 s)."""
    with _lock:
        for ref in reference_videos(media_dir):
            p = Path(ref["path"])
            if p.exists():
                continue
            spec = video_api.build_spec(ref["_visual"], caption=ref["_voiceover"], guideline_id=ref["guideline_id"],
                                        seed_text=ref["id"])
            render.write_video(render.scene_frames(spec, 4.0), p)


def public(ref: dict) -> dict:
    return {k: v for k, v in ref.items() if not k.startswith("_") and k != "path"}
