"""Process 1 — sample-based profiling of the table collection.

(r1 tables)* -> [tool select] -> + (r2 samples)*
            -> [tool extract] -> + (r3 profiles)*
            -> [tool evaluate] -> + (r4 quality)
            -> [tool expand] -> (r1)* + (r2)*   (loop until every column is stable)
"""
from __future__ import annotations

import pandas as pd

SEED = 13


def select_samples(tables: dict[str, pd.DataFrame], sizes: dict[str, int]) -> dict[str, pd.DataFrame]:
    """[tool select] r1 -> r2: a seeded row sample per table."""
    samples = {}
    for name, df in tables.items():
        n = min(sizes.get(name, len(df)), len(df))
        samples[name] = df if n >= len(df) else df.sample(n=n, random_state=SEED).sort_index()
    return samples


def _dtype_name(s: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(s):
        return "bool"
    if pd.api.types.is_integer_dtype(s):
        return "int"
    if pd.api.types.is_float_dtype(s):
        return "float"
    return "str"


def extract_profiles(tables: dict[str, pd.DataFrame], samples: dict[str, pd.DataFrame]) -> list[dict]:
    """[tool extract] r2 -> r3: one profile record per column, computed on the sample."""
    profiles = []
    for tname, sample in samples.items():
        n = len(sample)
        for pos, col in enumerate(sample.columns):
            s = sample[col]
            non_null = s.dropna()
            distinct = int(non_null.nunique())
            prof = {
                "id": f"{tname}.{col}",
                "table": tname,
                "column": col,
                "position": pos,
                "dtype": _dtype_name(s),
                "sample_size": n,
                "table_size": len(tables[tname]),
                "null_ratio": round(float(s.isna().mean()) if n else 0.0, 4),
                "distinct_count": distinct,
                "distinct_ratio": round(distinct / len(non_null), 4) if len(non_null) else 0.0,
                "avg_length": round(float(non_null.astype(str).str.len().mean()), 2) if len(non_null) else 0.0,
                "examples": [str(v) for v in non_null.drop_duplicates().head(5).tolist()],
            }
            if prof["dtype"] in ("int", "float") and len(non_null):
                prof["min"], prof["max"] = float(non_null.min()), float(non_null.max())
            profiles.append(prof)
    return profiles


def evaluate_samples(profiles: list[dict]) -> pd.DataFrame:
    """[tool evaluate] r3 -> r4: is each column's profile trustworthy at this sample size?

    A column whose sample shows only unique values could still contain
    duplicates outside the sample, so its uniqueness (and thus key status) is
    undecided until the whole table is read. Columns with duplicates already
    in the sample are settled.
    """
    rows = []
    for p in profiles:
        full = p["sample_size"] >= p["table_size"]
        unique_in_sample = p["distinct_ratio"] >= 1.0 and p["null_ratio"] == 0
        stable = full or not unique_in_sample
        rows.append({
            "column": p["id"],
            "sample_size": p["sample_size"],
            "table_size": p["table_size"],
            "coverage": round(p["sample_size"] / p["table_size"], 3) if p["table_size"] else 1.0,
            "unique_in_sample": unique_in_sample,
            "stable": stable,
            "verdict": "settled" if stable else "undecided: expand sample",
        })
    return pd.DataFrame(rows)


def expand_samples(sizes: dict[str, int], quality: pd.DataFrame, tables: dict[str, pd.DataFrame]) -> dict[str, int]:
    """[tool expand] r4 -> (r1, r2): double the sample of every table with undecided columns."""
    new = dict(sizes)
    unstable_tables = {c.split(".", 1)[0] for c in quality.loc[~quality["stable"], "column"]}
    for t in unstable_tables:
        new[t] = min(len(tables[t]), max(1, sizes[t] * 2))
    return new


def run_profiling(tables: dict[str, pd.DataFrame], initial_sample: int = 50, max_rounds: int = 10) -> dict:
    """Run process 1 including its loop; the check in code stops when every column is stable."""
    sizes = {t: initial_sample for t in tables}
    rounds = []
    for i in range(max_rounds):
        samples = select_samples(tables, sizes)                  # r2
        profiles = extract_profiles(tables, samples)             # r3
        quality = evaluate_samples(profiles)                     # r4
        rounds.append({
            "round": i + 1,
            "sample_sizes": {t: len(s) for t, s in samples.items()},
            "undecided": int((~quality["stable"]).sum()),
        })
        if quality["stable"].all():
            break
        sizes = expand_samples(sizes, quality, tables)           # loop back to (r1, r2)
    return {"samples": samples, "profiles": profiles, "quality": quality, "rounds": rounds}
