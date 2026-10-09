"""r1_1: the corpus of chart programs used to build training data."""
from __future__ import annotations

import os
import re

from render import validate_code

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_DIR = os.path.join(HERE, "seed_corpus")
USER_DIR = os.path.join(os.path.dirname(HERE), "data", "corpus_user")


def _read_dir(d: str, origin: str) -> list[dict]:
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(os.listdir(d)):
        if not name.endswith(".py"):
            continue
        with open(os.path.join(d, name)) as f:
            code = f.read()
        first = code.splitlines()[0] if code else ""
        title = first.lstrip("# ").strip() if first.startswith("#") else name[:-3]
        out.append({"id": f"{origin}/{name[:-3]}", "title": title, "code": code, "origin": origin})
    return out


def list_scripts() -> list[dict]:
    return _read_dir(SEED_DIR, "seed") + _read_dir(USER_DIR, "user")


def add_script(title: str, code: str) -> dict:
    validate_code(code)
    os.makedirs(USER_DIR, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")[:40] or "script"
    path = os.path.join(USER_DIR, f"{slug}.py")
    i = 2
    while os.path.exists(path):
        path = os.path.join(USER_DIR, f"{slug}_{i}.py")
        i += 1
    with open(path, "w") as f:
        f.write(f"# {title}\n{code}")
    name = os.path.basename(path)[:-3]
    return {"id": f"user/{name}", "title": title}


def delete_script(script_id: str) -> None:
    origin, _, name = script_id.partition("/")
    if origin != "user" or not re.fullmatch(r"[a-z0-9_]+", name):
        raise ValueError("Only user-added scripts can be removed.")
    os.remove(os.path.join(USER_DIR, f"{name}.py"))
