"""Single entry point for every model call (model_1 generate, model_2 modify).

Swap the provider by replacing `call_model`. The current provider is the locally
installed Claude Code CLI, started with the CLAUDECODE variable removed.
"""
from __future__ import annotations

import json
import os
import re
import subprocess

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
TIMEOUT_S = int(os.environ.get("MODEL_TIMEOUT_S", "240"))


class ModelError(RuntimeError):
    pass


def call_model(prompt: str, system: str | None = None) -> str:
    """Send a prompt to the model provider and return its text reply."""
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    cmd = [CLAUDE_BIN, "-p", prompt, "--output-format", "json"]
    if system:
        cmd += ["--system-prompt", system]
    try:
        proc = subprocess.run(
            cmd, env=env, capture_output=True, text=True, timeout=TIMEOUT_S,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            stdin=subprocess.DEVNULL,
        )
    except FileNotFoundError as e:
        raise ModelError(f"Claude CLI not found ({CLAUDE_BIN})") from e
    except subprocess.TimeoutExpired as e:
        raise ModelError(f"Model call timed out after {TIMEOUT_S}s") from e
    if proc.returncode != 0:
        raise ModelError(f"Claude CLI failed: {proc.stderr.strip() or proc.stdout.strip()[:500]}")
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise ModelError(f"Unparseable CLI output: {proc.stdout[:300]}") from e
    if payload.get("is_error"):
        raise ModelError(f"Model error: {payload.get('result')}")
    return payload.get("result", "")


def call_model_json(prompt: str, system: str | None = None) -> dict:
    """Call the model and parse a JSON object out of its reply."""
    text = call_model(prompt, system)
    return extract_json(text)


def extract_json(text: str) -> dict:
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    candidate = fence.group(1) if fence else text
    start, end = candidate.find("{"), candidate.rfind("}")
    if start < 0 or end < 0:
        raise ModelError(f"No JSON object in model reply: {text[:300]}")
    try:
        return json.loads(candidate[start:end + 1])
    except json.JSONDecodeError as e:
        raise ModelError(f"Invalid JSON in model reply: {e}") from e
