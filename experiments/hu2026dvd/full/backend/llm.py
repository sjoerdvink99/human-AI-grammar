"""The single model-provider function.

Every model step in the design (model_1 generate, model_2 generate, model_3 extract)
calls `call_model`. It runs the locally installed Claude Code CLI in print mode with
JSON output. To swap providers, replace the body of `call_model` only.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any


class ModelError(RuntimeError):
    pass


def _claude_bin() -> str:
    exe = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
    if not exe:
        raise ModelError("The `claude` CLI was not found on PATH (set CLAUDE_BIN to override).")
    return exe


def call_model(
    role: str,
    prompt: str,
    *,
    system: str | None = None,
    schema: dict | None = None,
    image_paths: list[str | Path] | None = None,
    timeout: int = 300,
) -> Any:
    """Call a model and return parsed JSON (when `schema` is given) or text.

    role         -- design actor name (model_1, model_2, model_3); recorded for logging
                    and available to route roles to different providers/configs.
    system       -- role-specific system prompt.
    schema       -- JSON Schema; output is returned as a dict validated by the CLI.
    image_paths  -- images the model must look at (read via the CLI's Read tool).
    """
    cmd = [_claude_bin(), "-p", prompt, "--output-format", "json"]
    if system:
        cmd += ["--system-prompt", system]
    if schema is not None:
        cmd += ["--json-schema", json.dumps(schema)]
    cwd = None
    if image_paths:
        dirs = sorted({str(Path(p).resolve().parent) for p in image_paths})
        cmd += ["--tools", "Read", "--allowedTools", "Read"]
        for d in dirs:
            cmd += ["--add-dir", d]
        cwd = dirs[0]
    else:
        cmd += ["--tools", ""]
    model = os.environ.get(f"SYSTEMX_{role.upper()}_MODEL")
    if model:
        cmd += ["--model", model]

    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env, cwd=cwd)
    except subprocess.TimeoutExpired as e:
        raise ModelError(f"{role}: model call timed out after {timeout}s") from e
    if proc.returncode != 0 and not proc.stdout.strip():
        raise ModelError(f"{role}: claude exited {proc.returncode}: {proc.stderr.strip()[:500]}")
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise ModelError(f"{role}: could not parse CLI output: {proc.stdout[:300]}") from e
    if envelope.get("is_error"):
        raise ModelError(f"{role}: {envelope.get('result') or envelope.get('subtype')}")

    if schema is None:
        return envelope.get("result", "")
    if isinstance(envelope.get("structured_output"), dict):
        return envelope["structured_output"]
    return extract_json(envelope.get("result", ""))


def extract_json(text: str) -> Any:
    """Parse the first JSON object in a text answer (tolerates code fences)."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise ModelError(f"model did not return JSON: {text[:300]}")
