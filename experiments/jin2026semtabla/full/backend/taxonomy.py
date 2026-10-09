"""Column taxonomy: rule-based assignment (tool_1 assign) and model_1 prediction for the
columns the rules leave ambiguous (model_1 assign)."""
from __future__ import annotations

import json
import re

from .llm import ModelError, call_model

TAXONOMY: dict[str, str] = {
    "identifier": "surrogate or natural key, reference number, foreign key",
    "person_name": "first, last or full names of people",
    "organization": "names of companies, stores, brands",
    "email": "e-mail addresses",
    "phone": "phone or fax numbers",
    "url": "web addresses",
    "address": "street addresses",
    "city": "city or town names",
    "country": "country names or codes",
    "postal_code": "postal or ZIP codes",
    "temporal": "dates, times, timestamps, years",
    "monetary": "prices, amounts, costs, revenue",
    "quantity": "counts and quantities of items",
    "measurement": "physical measurements: weight, length, temperature",
    "percentage": "ratios, rates and percentages",
    "categorical_code": "status values, types, enumerations, short codes",
    "boolean_flag": "yes/no, true/false indicators",
    "title_or_label": "names of products, categories or other things",
    "free_text": "descriptions, comments, notes",
    "currency": "currency codes or names",
    "other": "none of the above",
}
AMBIGUOUS = "ambiguous"
ID_NAME = re.compile(r"(^id$|_id$|^id_|_key$|_ref$|_no$|_number$|^uuid$|_uuid$)", re.I)


# --------------------------------------------------------------------------- [tool_1 assign]
def rule_taxonomy(attr: dict) -> tuple[str, str]:
    name, pat, ratio = attr["column"], attr.get("pattern"), attr.get("pattern_ratio") or 0
    fam = attr.get("family")
    if fam == "bool" or (pat == "boolean" and ratio >= 0.99):
        return "boolean_flag", "boolean type"
    if fam == "time" or (pat in ("iso_date", "datetime") and ratio >= 0.95):
        return "temporal", "date/time values"
    if pat == "email" and ratio >= 0.95:
        return "email", f"{ratio:.0%} of values match an e-mail pattern"
    if pat == "url" and ratio >= 0.95:
        return "url", f"{ratio:.0%} of values match a URL pattern"
    if ID_NAME.search(name) and fam in ("int", "text") and (attr.get("verified_unique") or attr.get("uniqueness", 0) < 1):
        return "identifier", "identifier-like name with key-like values"
    if attr.get("verified_unique") and fam == "int" and attr.get("is_sequential"):
        return "identifier", "unique sequential integers"
    return AMBIGUOUS, "no rule applies"


def assign_rule_taxonomies(column_attributes: list[dict]) -> dict[str, dict]:
    out = {}
    for a in column_attributes:
        cat, why = rule_taxonomy(a)
        out[a["key"]] = {"category": cat, "reason": why}
    return out


# --------------------------------------------------------------------------- [model_1 assign]
SYSTEM_PROMPT = (
    "You are a column taxonomy classifier for relational database profiling. "
    "Given measured attributes and sample values of database columns, assign each column exactly "
    "one category from the fixed taxonomy. Base the decision on the column name, its table context, "
    "the value pattern and the sample values."
)


def build_prompt(columns: list[dict], table_context: dict[str, list[str]]) -> str:
    tax = "\n".join(f"- {k}: {v}" for k, v in TAXONOMY.items())
    items = []
    for a in columns:
        items.append({
            "key": a["key"],
            "table": a["table"],
            "column": a["column"],
            "other_columns_in_table": table_context.get(a["table"], []),
            "type": a["type"],
            "pattern": a.get("pattern"),
            "pattern_ratio": a.get("pattern_ratio"),
            "uniqueness": a.get("uniqueness"),
            "null_ratio": a.get("null_ratio"),
            "min": a.get("min"),
            "max": a.get("max"),
            "sample_values": a.get("sample_values", [])[:8],
        })
    return (
        f"Taxonomy (use these category ids exactly):\n{tax}\n\n"
        f"Columns:\n{json.dumps(items, indent=1, default=str)}\n\n"
        'Return {"columns": [{"key": <key>, "category": <category id>, "confidence": <0..1>, '
        '"rationale": <one short sentence>}]} with one entry per column.'
    )


def predict_taxonomies(column_attributes: list[dict], rule_taxonomies: dict[str, dict]) -> dict[str, dict]:
    ambiguous = [a for a in column_attributes if rule_taxonomies[a["key"]]["category"] == AMBIGUOUS]
    if not ambiguous:
        return {}
    context: dict[str, list[str]] = {}
    for a in column_attributes:
        context.setdefault(a["table"], []).append(a["column"])
    out: dict[str, dict] = {}
    try:
        result = call_model(SYSTEM_PROMPT, build_prompt(ambiguous, context))
        entries = result.get("columns", []) if isinstance(result, dict) else result
        for e in entries:
            if not isinstance(e, dict) or e.get("key") not in rule_taxonomies:
                continue
            cat = str(e.get("category", "")).strip().lower()
            valid = cat in TAXONOMY
            try:
                conf = max(0.0, min(1.0, float(e.get("confidence", 0.5))))
            except (TypeError, ValueError):
                conf = 0.5
            out[e["key"]] = {
                "category": cat if valid else "other",
                "confidence": conf if valid else 0.0,
                "rationale": str(e.get("rationale", ""))[:300] if valid else f"model returned invalid category '{cat}'",
            }
        error = None
    except ModelError as e:
        error = str(e)
    for a in ambiguous:
        if a["key"] not in out:
            out[a["key"]] = {"category": "other", "confidence": 0.0,
                             "rationale": f"model gave no answer{': ' + error if error else ''}", "error": True}
    return out
