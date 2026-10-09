"""Single entry point for language-model calls (model_1: column taxonomy classification).

Swap the provider by changing `call_model` only. The default provider shells out to the
locally installed Claude Code CLI (`claude -p --output-format json`) with CLAUDECODE removed
from the environment.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess

CLAUDE_BIN = os.environ.get("SYSTEMX_CLAUDE_BIN", "claude")
TIMEOUT_S = int(os.environ.get("SYSTEMX_MODEL_TIMEOUT", "180"))


class ModelError(RuntimeError):
    pass


def _extract_json(text: str):
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start, end = text.find(open_c), text.rfind(close_c)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ModelError(f"model output was not valid JSON: {text[:300]}")


def call_model(system: str, prompt: str) -> dict | list:
    """Send one prompt to the model and return the parsed JSON object it answers with."""
    if os.environ.get("SYSTEMX_FAKE_MODEL"):
        # Test hook: deterministic stand-in so the pipeline runs without the CLI.
        return json.loads(os.environ["SYSTEMX_FAKE_MODEL"])
    if shutil.which(CLAUDE_BIN) is None:
        raise ModelError(f"'{CLAUDE_BIN}' CLI not found on PATH")
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    full_prompt = f"{system}\n\n{prompt}\n\nRespond with JSON only, no prose and no code fences."
    try:
        proc = subprocess.run(
            [CLAUDE_BIN, "-p", "--output-format", "json"],
            input=full_prompt,
            capture_output=True,
            text=True,
            env=env,
            timeout=TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as e:
        raise ModelError(f"model call timed out after {TIMEOUT_S}s") from e
    if proc.returncode != 0:
        raise ModelError(f"claude CLI failed ({proc.returncode}): {proc.stderr[:300] or proc.stdout[:300]}")
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise ModelError(f"unexpected CLI output: {proc.stdout[:300]}") from e
    if envelope.get("is_error"):
        raise ModelError(f"model returned an error: {envelope.get('result')}")
    return _extract_json(str(envelope.get("result", "")))
