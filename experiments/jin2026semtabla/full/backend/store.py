"""Workspace state: the uploaded tables (tables_1) in DuckDB plus every derived representation."""
from __future__ import annotations

import copy
import io
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

import duckdb
import pandas as pd


def q(name: str) -> str:
    """Quote an SQL identifier."""
    return '"' + str(name).replace('"', '""') + '"'


def lit(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def sample_name(table: str) -> str:
    return f"__s_{table}"


def json_value(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if hasattr(v, "item"):
        try:
            return json_value(v.item())
        except Exception:
            pass
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    if v is pd.NaT:
        return None
    return v


def clean_table_name(name: str) -> str:
    name = re.sub(r"\.[A-Za-z0-9]+$", "", name)
    name = re.sub(r"[^A-Za-z0-9_]", "_", name).strip("_").lower() or "table"
    if name[0].isdigit():
        name = "t_" + name
    return name


@dataclass
class Workspace:
    con: duckdb.DuckDBPyConnection = field(default_factory=lambda: duckdb.connect(":memory:"))
    table_names: list[str] = field(default_factory=list)
    detection: dict | None = None            # process 1 result (samples summary, detected_features, log)
    column_attributes: list[dict] | None = None
    rule_taxonomies: dict | None = None
    predicted_taxonomies: dict | None = None
    column_semantics: list[dict] | None = None
    key_relations: dict | None = None
    functional_dependencies: list[dict] | None = None
    table_labels: dict | None = None
    table_types: dict | None = None
    type_overrides: dict = field(default_factory=dict)   # process 5 corrections, pinned in later predictions
    profiles: list[dict] = field(default_factory=list)   # semantic_profile versions (_1, _2, ...)
    stages_done: list[str] = field(default_factory=list)

    # ---------------- tables_1 ----------------
    def reset(self):
        self.con.close()
        fresh = Workspace()
        self.__dict__.update(fresh.__dict__)

    def add_dataframe(self, name: str, df: pd.DataFrame):
        name = self._unique(clean_table_name(name))
        self.con.register("__df", df)
        self.con.execute(f"CREATE TABLE {q(name)} AS SELECT * FROM __df")
        self.con.unregister("__df")
        self.table_names.append(name)
        return name

    def add_csv(self, filename: str, content: bytes):
        name = self._unique(clean_table_name(filename))
        path_df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False)
        # Let DuckDB infer types from the text, which keeps leading zeros in codes such as ZIPs.
        self.con.register("__raw", path_df)
        cols = []
        for c in path_df.columns:
            cols.append(f"NULLIF(TRIM({q(c)}), '') AS {q(c)}")
        self.con.execute(f"CREATE TEMP TABLE __txt AS SELECT {', '.join(cols)} FROM __raw")
        self.con.unregister("__raw")
        casts = []
        for c in path_df.columns:
            casts.append(f"{self._infer_cast(c)} AS {q(c)}")
        self.con.execute(f"CREATE TABLE {q(name)} AS SELECT {', '.join(casts)} FROM __txt")
        self.con.execute("DROP TABLE __txt")
        self.table_names.append(name)
        return name

    def _infer_cast(self, col: str) -> str:
        c = q(col)
        for typ in ("BIGINT", "DOUBLE", "DATE", "TIMESTAMP", "BOOLEAN"):
            bad = self.con.execute(
                f"SELECT count(*) FROM __txt WHERE {c} IS NOT NULL AND TRY_CAST({c} AS {typ}) IS NULL"
            ).fetchone()[0]
            nonnull = self.con.execute(f"SELECT count({c}) FROM __txt").fetchone()[0]
            if nonnull == 0:
                return f"{c}"
            if bad == 0:
                if typ in ("BIGINT", "DOUBLE"):
                    lead = self.con.execute(
                        f"SELECT count(*) FROM __txt WHERE regexp_matches({c}, '^0[0-9]')"
                    ).fetchone()[0]
                    if lead:
                        return c  # keep codes with leading zeros as text
                if typ == "BOOLEAN":
                    ok = self.con.execute(
                        f"SELECT count(*) FROM __txt WHERE lower({c}) NOT IN ('true','false','t','f','yes','no','y','n')"
                    ).fetchone()[0]
                    if ok:
                        return c
                return f"TRY_CAST({c} AS {typ})"
        return c

    def _unique(self, name: str) -> str:
        base, i = name, 2
        while name in self.table_names:
            name = f"{base}_{i}"
            i += 1
        return name

    def columns(self, table: str, source: str | None = None) -> list[tuple[str, str]]:
        rows = self.con.execute(f"DESCRIBE {q(source or table)}").fetchall()
        return [(r[0], r[1]) for r in rows if r[0] != "__rid"]

    def row_count(self, table: str) -> int:
        return self.con.execute(f"SELECT count(*) FROM {q(table)}").fetchone()[0]

    def rows(self, sql: str, limit: int | None = None) -> list[dict]:
        if limit is not None:
            sql = f"SELECT * FROM ({sql}) LIMIT {int(limit)}"
        cur = self.con.execute(sql)
        names = [d[0] for d in cur.description]
        return [{n: json_value(v) for n, v in zip(names, r) if n != "__rid"} for r in cur.fetchall()]

    def scalar(self, sql: str):
        return json_value(self.con.execute(sql).fetchone()[0])

    def preview(self, table: str, limit: int = 20) -> dict:
        return {
            "name": table,
            "rows": self.row_count(table),
            "columns": [{"name": n, "type": t} for n, t in self.columns(table)],
            "preview": self.rows(f"SELECT * FROM {q(table)}", limit),
        }

    # ---------------- semantic_profile versions ----------------
    @property
    def profile(self) -> dict | None:
        return self.profiles[-1] if self.profiles else None

    def push_profile(self, profile: dict) -> dict:
        profile = copy.deepcopy(profile)
        profile["version"] = len(self.profiles) + 1
        self.profiles.append(profile)
        return profile


WS = Workspace()
