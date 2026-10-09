"""Process 3 — validate a feature the user selected in the semantic views with SQL."""
from features import PATTERN_RE, feature_conditions
from store import Store, qi, ql

ROW_LIMIT = 20


def _type_condition(t, c, semantic_type):
    """Support condition that a value fits a semantic type (None -> handled specially)."""
    s = f"CAST({c} AS VARCHAR)"
    num = f"TRY_CAST({s} AS DOUBLE)"

    def rx(r):
        return f"regexp_full_match({s}, {ql(r)})"
    return {
        "email": rx(PATTERN_RE["email"]), "url": rx(PATTERN_RE["url"]), "phone": rx(PATTERN_RE["phone"]),
        "date": f"TRY_CAST({s} AS DATE) IS NOT NULL", "datetime": f"TRY_CAST({s} AS TIMESTAMP) IS NOT NULL",
        "year": f"TRY_CAST({s} AS BIGINT) BETWEEN 1800 AND 2100",
        "country_code": rx("[A-Z]{2}"), "currency_code": rx("[A-Z]{3}"),
        "postal_code": rx("[A-Za-z0-9][A-Za-z0-9 -]{2,9}"),
        "currency_amount": f"{num} >= 0", "quantity": f"TRY_CAST({s} AS BIGINT) >= 0",
        "measure": f"{num} IS NOT NULL", "percentage": f"{num} BETWEEN 0 AND 100",
        "latitude": f"{num} BETWEEN -90 AND 90", "longitude": f"{num} BETWEEN -180 AND 180",
        "boolean": f"lower({s}) IN ('true','false','0','1','y','n','yes','no')",
        "person_name": rx(r"[^0-9@]*[A-Za-z][^0-9@]*"), "entity_name": rx(r".*[A-Za-z].*"),
        "city": rx(r"[^0-9@]*[A-Za-z][^0-9@]*"), "country": rx(r"[^0-9@]*[A-Za-z][^0-9@]*"),
        "address": rx(r".*[A-Za-z].*"), "code": rx(r"[A-Za-z0-9_.\-]+"),
        "description": f"length({s}) >= 10",
        "category": f"{c} IN (SELECT {c} FROM {t} GROUP BY {c} HAVING COUNT(*) >= 2)",
        "status": f"{c} IN (SELECT {c} FROM {t} GROUP BY {c} HAVING COUNT(*) >= 2)",
    }.get(semantic_type)


def translate_to_queries(selected_feature):
    """[tool_1 translate] tables_1* + selected_feature_1 -> validation_queries_1* (SQL)"""
    k = selected_feature["kind"]
    if k in ("column_type", "primary_key"):
        t, c = qi(selected_feature["table"]), qi(selected_feature["column"])
        st = selected_feature.get("semantic_type")
        if k == "primary_key" or st == "identifier":
            dup = f"{c} IN (SELECT {c} FROM {t} GROUP BY {c} HAVING COUNT(*) > 1)"
            sup, bad = f"{c} IS NOT NULL AND NOT ({dup})", f"{c} IS NULL OR {dup}"
            what = "unique and not null"
        else:
            cond = _type_condition(t, c, st)
            if cond is None:
                sup, bad, what = f"{c} IS NOT NULL", f"{c} IS NULL", "present (no specific check for this type)"
            else:
                sup, bad, what = f"{c} IS NOT NULL AND ({cond})", f"{c} IS NOT NULL AND NOT ({cond})", f"a valid {st}"
        return [
            {"name": f"values of {selected_feature['column']} that are {what}", "purpose": "support",
             "sql": f"SELECT * FROM {t}\nWHERE {sup}"},
            {"name": f"values of {selected_feature['column']} that are not {what}", "purpose": "counter",
             "sql": f"SELECT * FROM {t}\nWHERE {bad}" + (f"\nORDER BY {c}" if "HAVING" in bad else "")},
        ]
    if k == "foreign_key":
        t1, a = qi(selected_feature["from_table"]), qi(selected_feature["from_column"])
        t2, b = qi(selected_feature["to_table"]), qi(selected_feature["to_column"])
        ref = f"(SELECT CAST({b} AS VARCHAR) FROM {t2})"
        return [
            {"name": "rows whose reference resolves", "purpose": "support",
             "sql": f"SELECT * FROM {t1}\nWHERE CAST({a} AS VARCHAR) IN {ref}"},
            {"name": "orphan rows (reference not found)", "purpose": "counter",
             "sql": f"SELECT * FROM {t1}\nWHERE {a} IS NOT NULL\n  AND CAST({a} AS VARCHAR) NOT IN {ref}"},
        ]
    if k == "fd":
        t, x, y = qi(selected_feature["table"]), qi(selected_feature["lhs"]), qi(selected_feature["rhs"])
        return [
            {"name": f"{selected_feature['lhs']} groups with a single {selected_feature['rhs']}", "purpose": "support",
             "sql": f"SELECT {x}, ANY_VALUE({y}) AS {y}, COUNT(*) AS n_rows\nFROM {t}\nGROUP BY {x}\n"
                    f"HAVING COUNT(DISTINCT COALESCE(CAST({y} AS VARCHAR), '∅')) = 1\nORDER BY n_rows DESC"},
            {"name": f"rows where one {selected_feature['lhs']} maps to several {selected_feature['rhs']}",
             "purpose": "counter",
             "sql": f"SELECT * FROM {t}\nWHERE {x} IN (\n  SELECT {x} FROM {t} GROUP BY {x}\n"
                    f"  HAVING COUNT(DISTINCT COALESCE(CAST({y} AS VARCHAR), '∅')) > 1)\nORDER BY {x}"},
        ]
    if k == "feature":
        f = selected_feature["feature"]
        sup, bad = feature_conditions(f)
        t = qi(f["table"])
        return [{"name": f"rows satisfying: {f['description']}", "purpose": "support",
                 "sql": f"SELECT * FROM {t}\nWHERE {sup}"},
                {"name": f"rows violating: {f['description']}", "purpose": "counter",
                 "sql": f"SELECT * FROM {t}\nWHERE {bad}"}]
    raise ValueError(f"unknown selection kind {k}")


def execute_queries(store: Store, queries):
    """[tool_1 execute] validation_queries_1* -> supporting_samples_1 + counterexamples_2"""
    out = {}
    for q in queries:
        count = store.scalar(f"SELECT COUNT(*) FROM ({q['sql']}) q")
        cols, rows = store.query(f"SELECT * FROM ({q['sql']}) q LIMIT {ROW_LIMIT}")
        q["count"] = count
        out[q["purpose"]] = {"query": q["name"], "count": count, "columns": cols, "rows": rows}
    return out.get("support"), out.get("counter")


def run_process3(store: Store, selected_feature):
    queries = translate_to_queries(selected_feature)
    supporting, counter = execute_queries(store, queries)
    return {"selected_feature": selected_feature, "validation_queries": queries,
            "supporting_samples": supporting, "counterexamples": counter}
