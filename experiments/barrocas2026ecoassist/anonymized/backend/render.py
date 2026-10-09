"""tool_1 execute and tool_5 translate: run chart programs in an isolated subprocess."""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys

WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render_worker.py")
ALLOWED_IMPORTS = {"matplotlib", "numpy", "math", "random", "datetime", "collections",
                   "itertools", "string", "textwrap", "calendar", "statistics"}
FORBIDDEN_CALLS = {"open", "eval", "exec", "__import__", "compile", "input", "savefig"}


class CodeError(ValueError):
    pass


def validate_code(code: str) -> None:
    """Static check applied to every chart program before it is executed."""
    if not code or not code.strip():
        raise CodeError("Empty program.")
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise CodeError(f"Syntax error on line {e.lineno}: {e.msg}") from e
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module or ""]
        else:
            names = []
        for n in names:
            if n.split(".")[0] not in ALLOWED_IMPORTS:
                raise CodeError(f"Import of '{n}' is not allowed.")
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
            if name in FORBIDDEN_CALLS:
                raise CodeError(f"Call to '{name}' is not allowed.")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise CodeError("Dunder attribute access is not allowed.")


def _run_worker(jobs: list[dict], timeout: int) -> list[dict]:
    env = dict(os.environ, MPLBACKEND="Agg")
    proc = subprocess.run([sys.executable, "-I", WORKER], input=json.dumps(jobs),
                          capture_output=True, text=True, timeout=timeout, env=env)
    if proc.returncode != 0:
        raise RuntimeError(f"Render worker failed: {proc.stderr[-800:]}")
    return json.loads(proc.stdout)


def execute_many(programs: list[tuple[str, str]], timeout: int = 600) -> dict[str, dict]:
    """tool_1 execute over a collection: {id: rendering}."""
    jobs, results = [], {}
    for pid, code in programs:
        try:
            validate_code(code)
            jobs.append({"id": pid, "code": code, "format": "png"})
        except CodeError as e:
            results[pid] = {"id": pid, "ok": False, "error": str(e)}
    if jobs:
        for r in _run_worker(jobs, timeout):
            results[r["id"]] = r
    return results


def execute_code(code: str) -> dict:
    """tool_1 execute: program -> rendering (PNG + captured layout)."""
    return execute_many([("one", code)], timeout=60)["one"]


def translate_to_svg(code: str) -> dict:
    """tool_5 translate: final program -> exported vector chart (SVG)."""
    validate_code(code)
    return _run_worker([{"id": "svg", "code": code, "format": "svg"}], 60)[0]
