"""Process 1 — sample tables, detect features, check them against the full tables, and
expand the samples with counterexamples until the features hold (loop)."""
from features import detect_column_features, feature_conditions
from store import Store, qi

SAMPLE_SIZE = 30
MAX_ROUNDS = 4
CE_PER_FEATURE = 5


def select_samples(store: Store, tables, size=SAMPLE_SIZE, seed=42):
    """[tool_1 select] tables_1* -> samples_1*"""
    samples = {}
    for name in tables:
        _, rows = store.query(f"SELECT rowid AS __rowid, * FROM {qi(name)} "
                              f"USING SAMPLE reservoir({int(size)} ROWS) REPEATABLE ({int(seed)})")
        for r in rows:
            r["__round"] = 1
        samples[name] = sorted(rows, key=lambda r: r["__rowid"])
    return samples


def extract_features(store: Store, samples, round_no):
    """[tool_1 extract] samples_1* -> detected_features_1*"""
    feats = []
    for name, rows in samples.items():
        for col in store.tables[name]["columns"]:
            values = [r.get(col["name"]) for r in rows]
            feats += detect_column_features(name, col["name"], col["dtype"], values, round_no)
    return feats


def _extreme_expr(f):
    s = f"CAST({qi(f['column'])} AS VARCHAR)"
    if f["kind"] == "range":
        return f"TRY_CAST({s} AS DOUBLE)"
    if f["kind"] == "length":
        return f"length({s})"
    return None


def evaluate_features(store: Store, features, round_no):
    """[tool_1 evaluate] tables_1* + detected_features_1* -> counterexamples_1 (full-table check)"""
    counterexamples = []
    for f in features:
        _, bad = feature_conditions(f)
        n_bad = store.scalar(f"SELECT COUNT(*) FROM {qi(f['table'])} WHERE {bad}")
        f["violations"] = n_bad
        f["status"] = "holds" if n_bad == 0 else "violated"
        if n_bad:
            base = f"SELECT rowid AS __rowid, * FROM {qi(f['table'])} WHERE {bad}"
            ext = _extreme_expr(f)
            if ext:  # take the most extreme violations on both sides so one expansion covers them
                hi, lo = CE_PER_FEATURE // 2 + 1, CE_PER_FEATURE // 2
                _, rows = store.query(f"(({base}) ORDER BY {ext} DESC LIMIT {hi}) UNION "
                                      f"(({base}) ORDER BY {ext} ASC LIMIT {lo})")
            else:
                _, rows = store.query(f"{base} LIMIT {CE_PER_FEATURE}")
            for r in rows:
                counterexamples.append({"round": round_no, "feature_id": f["id"], "feature": f["description"],
                                        "table": f["table"], "column": f["column"],
                                        "value": r.get(f["column"]), "row": r})
    return counterexamples


def expand_samples(samples, counterexamples, round_no):
    """[tool_1 expand] samples_1* + counterexamples_1 -> samples_1* (enlarged)"""
    added = 0
    for ce in counterexamples:
        rows = samples[ce["table"]]
        if any(r["__rowid"] == ce["row"]["__rowid"] for r in rows):
            continue
        rows.append({**ce["row"], "__round": round_no + 1})
        added += 1
    for rows in samples.values():
        rows.sort(key=lambda r: r["__rowid"])
    return added


def run_process1(store: Store, tables, progress, size=SAMPLE_SIZE):
    progress("[tool_1 select] samples_1")
    samples = select_samples(store, tables, size)
    rounds = []
    round_no = 1
    while True:
        progress(f"round {round_no}: [tool_1 extract] detected_features_1")
        features = extract_features(store, samples, round_no)
        progress(f"round {round_no}: [tool_1 evaluate] counterexamples_1")
        ces = evaluate_features(store, features, round_no)
        rounds.append({"round": round_no, "sample_sizes": {t: len(r) for t, r in samples.items()},
                       "n_features": len(features), "n_violated": sum(f["status"] == "violated" for f in features),
                       "counterexamples": ces})
        if not ces or round_no >= MAX_ROUNDS:
            break
        progress(f"round {round_no}: [tool_1 expand] samples_1 (+counterexamples)")
        if expand_samples(samples, ces, round_no) == 0:
            break
        round_no += 1
    return {"samples": samples, "detected_features": features, "rounds": rounds}
