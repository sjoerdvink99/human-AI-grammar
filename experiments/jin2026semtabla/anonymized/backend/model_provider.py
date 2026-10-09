"""Single entry point for language-model calls (model_1).

Swap the provider by changing `call_model`. The default runs the locally
installed Claude Code CLI with `claude -p --output-format json`, started
with the CLAUDECODE environment variable removed.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess


class ModelError(RuntimeError):
    pass


def call_model(prompt: str, *, system: str | None = None, timeout: int = 180) -> str:
    """Send a prompt to the model and return the text of its reply."""
    exe = shutil.which("claude")
    if not exe:
        raise ModelError("claude CLI not found on PATH")
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    cmd = [exe, "-p", prompt, "--output-format", "json"]
    if system:
        cmd += ["--append-system-prompt", system]
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise ModelError("model call timed out") from e
    if proc.returncode != 0:
        raise ModelError(f"claude exited {proc.returncode}: {proc.stderr[:500]}")
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise ModelError("could not parse CLI JSON envelope") from e
    if envelope.get("is_error"):
        raise ModelError(f"model error: {envelope.get('result')}")
    return envelope.get("result", "")


def call_model_json(prompt: str, **kw):
    """Call the model and parse the first JSON object or array in its reply."""
    text = call_model(prompt, **kw)
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise ModelError(f"no JSON in model reply: {text[:200]}")
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError as e:
        raise ModelError(f"invalid JSON in model reply: {e}") from e
    return obj
