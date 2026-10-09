"""The single model-provider function. Every model step (model_1, model_2) goes through call_model().

Provider: the locally installed Claude Code CLI, run as
    claude -p --output-format json --json-schema <schema> --tools ""
with the CLAUDECODE environment variable removed. To swap provider, replace call_model().
"""
import json
import os
import re
import subprocess
import tempfile

MODEL = os.environ.get("SYSTEMX_MODEL", "sonnet")
TIMEOUT = int(os.environ.get("SYSTEMX_MODEL_TIMEOUT", "300"))


class ModelError(RuntimeError):
    pass


def _extract_json(text):
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise ModelError("model reply contained no JSON")
    return json.loads(text[start:])


def call_model(prompt: str, schema: dict, system: str | None = None) -> dict:
    """Send one prompt; return a JSON object that conforms (structurally) to `schema`."""
    cmd = ["claude", "-p", "--output-format", "json", "--tools", "",
           "--json-schema", json.dumps(schema)]
    if MODEL:
        cmd += ["--model", MODEL]
    if system:
        cmd += ["--append-system-prompt", system]
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                              env=env, timeout=TIMEOUT, cwd=tempfile.gettempdir())
    except FileNotFoundError as e:
        raise ModelError("claude CLI not found on PATH") from e
    except subprocess.TimeoutExpired as e:
        raise ModelError(f"model call timed out after {TIMEOUT}s") from e
    if proc.returncode != 0 and not proc.stdout.strip():
        raise ModelError(f"claude CLI failed: {proc.stderr.strip()[:500]}")
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise ModelError(f"unparseable CLI output: {proc.stdout[:300]}") from e
    if envelope.get("is_error"):
        raise ModelError(f"model error: {str(envelope.get('result'))[:500]}")
    out = envelope.get("structured_output")
    if out is None:
        out = _extract_json(envelope.get("result") or "")
    if not isinstance(out, dict):
        raise ModelError("model output is not a JSON object")
    return out
