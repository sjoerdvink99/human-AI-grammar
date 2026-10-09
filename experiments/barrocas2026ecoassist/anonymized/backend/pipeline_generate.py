"""Process 2: (r10 request + r11 chart type) -> [model_1 generate]~ -> (r12_1 program)."""
from __future__ import annotations

import re

from llm import ModelError, call_model_json
from render import CodeError, validate_code

CHART_TYPES = {
    # r11 value: (label, regex the program must match)
    "bar": ("Bar", r"\.bar\(|\.barh\("),
    "stacked_bar": ("Stacked bar", r"bottom\s*=|left\s*="),
    "line": ("Line", r"\.plot\("),
    "scatter": ("Scatter", r"\.scatter\("),
    "histogram": ("Histogram", r"\.hist\("),
    "pie": ("Pie", r"\.pie\("),
}

GENERATE_SYSTEM = (
    "You are model_1, a chart-programming model. You write short, self-contained Python programs "
    "that draw one matplotlib figure. Reply with JSON only."
)


def build_generate_prompt(request: str, chart_type: str, feedback: str | None = None) -> str:
    label = CHART_TYPES[chart_type][0]
    extra = f"\nYour previous attempt was rejected: {feedback}\nFix that problem.\n" if feedback else ""
    return f"""Write a matplotlib program for this request.

REQUEST (r10): {request}
CHART TYPE (r11): {label}

Rules:
- Draw exactly one figure using `import matplotlib.pyplot as plt` (numpy allowed) and the {label.lower()} chart type.
- Put any data inline (invent plausible example data if the request does not give it).
- Allowed imports: matplotlib, numpy, math, random, datetime. No files, network, plt.show() or plt.savefig().
- Write the program plainly, as a typical first draft would be written; do not add layout tuning.
{extra}
Return JSON: {{"code": "<python program>"}}"""


def check_program(code: str, chart_type: str) -> None:
    """Validation of the generated r12_1: parses, is safe, and draws the chosen chart type."""
    validate_code(code)
    if not re.search(CHART_TYPES[chart_type][1], code):
        raise CodeError(f"The program does not draw a {CHART_TYPES[chart_type][0].lower()} chart.")


def generate(request: str, chart_type: str, attempts: int = 2) -> str:
    """model_1 generate."""
    if chart_type not in CHART_TYPES:
        raise ValueError(f"Unknown chart type '{chart_type}'.")
    if not request.strip():
        raise ValueError("The request is empty.")
    feedback = None
    for _ in range(attempts):
        out = call_model_json(build_generate_prompt(request, chart_type, feedback), GENERATE_SYSTEM)
        code = str(out.get("code", ""))
        try:
            check_program(code, chart_type)
            return code
        except CodeError as e:
            feedback = str(e)
    raise ModelError(f"model_1 could not produce a valid program: {feedback}")
