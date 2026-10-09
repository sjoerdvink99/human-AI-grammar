"""tables_1: the collection of input tables, held in DuckDB."""
import datetime
import decimal
import os
import re
import threading

import duckdb


def qi(name: str) -> str:
    """Quote an identifier for SQL."""
    return '"' + name.replace('"', '""') + '"'


def ql(value) -> str:
    """Quote a literal for SQL."""
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def jsonable(v):
    if isinstance(v, (datetime.date, datetime.datetime, datetime.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, bytes):
        return v.hex()
    return v


class Store:
    def __init__(self):
        self.con = duckdb.connect()
        self.lock = threading.RLock()
        self.tables: dict[str, dict] = {}

    def sanitize(self, name: str) -> str:
        name = re.sub(r"\.csv$", "", os.path.basename(name), flags=re.I)
        name = re.sub(r"[^A-Za-z0-9_]", "_", name).strip("_").lower() or "table"
        if name[0].isdigit():
            name = "t_" + name
        return name

    def load_csv(self, path: str, name: str | None = None) -> str:
        name = self.sanitize(name or path)
        with self.lock:
            self.con.execute(f"CREATE OR REPLACE TABLE {qi(name)} AS "
                             f"SELECT * FROM read_csv_auto({ql(path)}, header=true, sample_size=-1)")
            self._refresh(name)
        return name

    def drop(self, name: str):
        with self.lock:
            self.con.execute(f"DROP TABLE IF EXISTS {qi(name)}")
            self.tables.pop(name, None)

    def _refresh(self, name):
        cols = self.con.execute(f"DESCRIBE {qi(name)}").fetchall()
        n = self.con.execute(f"SELECT COUNT(*) FROM {qi(name)}").fetchone()[0]
        self.tables[name] = {"name": name, "n_rows": n,
                             "columns": [{"name": c[0], "dtype": c[1]} for c in cols]}

    def query(self, sql: str, params=None):
        """Run SQL; return (column names, list of row dicts)."""
        with self.lock:
            cur = self.con.execute(sql, params or [])
            names = [d[0] for d in cur.description]
            rows = [{k: jsonable(v) for k, v in zip(names, r)} for r in cur.fetchall()]
        return names, rows

    def scalar(self, sql: str):
        with self.lock:
            return jsonable(self.con.execute(sql).fetchone()[0])

    def preview(self, name, limit=50):
        cols, rows = self.query(f"SELECT * FROM {qi(name)} LIMIT {int(limit)}")
        return {"columns": cols, "rows": rows}
