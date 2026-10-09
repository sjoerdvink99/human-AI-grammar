"""FastAPI server: one in-memory workspace, one endpoint per process."""
from __future__ import annotations

import copy
import io
import threading
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import modeling as M
from .classifier import KEY_ROLES, KeyClassifier
from .profiling import run_profiling
from .query import execute_queries, load_sqlite, selection_to_sql

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / "sample_data"


class Workspace:
    """Application state, named after the design's identifiers."""

    def __init__(self) -> None:
        self.r1_tables: dict[str, pd.DataFrame] = {}
        self.con = None
        self.p1: dict | None = None          # r2 samples, r3 profiles, r4 quality, loop rounds
        self.p2: dict | None = None          # r5..r12
        self.r13_versions: list[dict] = []   # r13_1, r13_2, ...
        self.model_2 = KeyClassifier()
        self.r22_tree: dict | None = None
        self.lock = threading.Lock()

    def set_tables(self, tables: dict[str, pd.DataFrame]) -> None:
        self.__init__()
        self.r1_tables = tables
        self.con = load_sqlite(tables)


WS = Workspace()
app = FastAPI(title="System X")


def _need(cond, msg):
    if not cond:
        raise HTTPException(400, msg)


# ------------------------------------------------------------------ r1 input
@app.post("/api/tables")
async def upload_tables(files: list[UploadFile]):
    tables = {}
    for f in files:
        name = Path(f.filename or "table").stem.replace(" ", "_")
        try:
            tables[name] = pd.read_csv(io.BytesIO(await f.read()))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"could not read {f.filename}: {e}")
    _need(tables, "no files")
    WS.set_tables(tables)
    return _tables_summary()


@app.post("/api/sample")
def load_sample():
    WS.set_tables({p.stem: pd.read_csv(p) for p in sorted(SAMPLE_DIR.glob("*.csv"))})
    return _tables_summary()


def _tables_summary():
    return {"r1_tables": [{"name": n, "rows": len(df), "columns": list(df.columns),
                           "preview": df.head(8).astype(object).where(df.head(8).notna(), None).values.tolist()}
                          for n, df in WS.r1_tables.items()]}


# ------------------------------------------------------------------ process 1
class ProfileReq(BaseModel):
    initial_sample: int = 50


@app.post("/api/process1")
def process1(req: ProfileReq):
    _need(WS.r1_tables, "load tables first")
    with WS.lock:
        WS.p1 = run_profiling(WS.r1_tables, max(1, req.initial_sample))
    return _p1_view()


def _p1_view():
    p = WS.p1
    return {
        "rounds": p["rounds"],
        "r2_sample_sizes": {t: len(s) for t, s in p["samples"].items()},
        "r3_profiles": p["profiles"],
        "r4_quality": p["quality"].to_dict(orient="records"),
    }


# ------------------------------------------------------------------ process 2
@app.post("/api/process2")
def process2():
    _need(WS.p1, "run process 1 first")
    with WS.lock:
        t = WS.r1_tables
        r5 = M.extract_features(t, WS.p1["profiles"])
        r6 = M.assign_data_types(t, r5)
        r7_key = repr([(f["id"], r6[f["id"]], f["examples"]) for f in r5])
        if WS.p2 and WS.p2.get("r7_key") == r7_key:
            # unchanged inputs: carry r7 forward instead of asking model_1 again
            r7, model_1_meta = WS.p2["r7"], {**WS.p2["model_1"], "reused": True}
        else:
            r7, model_1_meta = M.assign_semantic_types(r5, r6)
        r8 = M.compose_columns(r5, r6, r7)
        r9 = M.extract_inclusion_graph(t, r8)
        r10 = M.extract_table_graph(r8, r9)
        r8 = M.add_degree_features(r8, r9["links"])
        r11 = M.assign_rule_keys(r8, r9, r10)
        if WS.model_2.tree is None:
            # bootstrap: before any human correction, model_2 is fitted on the rule labels r11
            WS.r22_tree = WS.model_2.train(r8, r11, source="rule labels (r11)")
        r12 = WS.model_2.predict(r8)
        r13 = M.compose_data_model(r8, r9, r10, r11, r12)
        WS.p2 = {"r5": r5, "r6": r6, "r7": r7, "r8": r8, "r9": r9, "r10": r10, "r11": r11, "r12": r12,
                 "model_1": model_1_meta, "r7_key": r7_key}
        WS.r13_versions = [r13]
    return _p2_view()


def _p2_view():
    p = WS.p2
    return {
        "r8_columns": [{k: c[k] for k in ("id", "table", "column", "data_type", "semantic_type", "distinct_ratio",
                                          "null_ratio", "is_unique", "in_degree", "out_degree", "examples")}
                       for c in p["r8"]],
        "r6_data_types": p["r6"], "r7_semantic_types": p["r7"],
        "r9_inclusion_graph": p["r9"], "r10_table_graph": p["r10"],
        "r11_rule_keys": p["r11"], "r12_model_keys": p["r12"],
        "model_1": p["model_1"],
        "r13_data_model": WS.r13_versions[-1], "r13_versions": len(WS.r13_versions),
        "r22_tree": WS.r22_tree,
    }


@app.get("/api/state")
def state():
    return {
        "tables": _tables_summary() if WS.r1_tables else None,
        "p1": _p1_view() if WS.p1 else None,
        "p2": _p2_view() if WS.p2 else None,
    }


# ------------------------------------------------------------------ process 3
class SelectReq(BaseModel):
    r15_selection: dict   # {"kind": "entity"|"relationship", "id": str, "column"?: str}


@app.post("/api/process3")
def process3(req: SelectReq):
    _need(WS.r13_versions, "build the data model first")
    dm = WS.r13_versions[-1]
    sel = req.r15_selection
    _need(sel.get("kind") in ("entity", "relationship"), "bad selection")
    try:
        r16 = selection_to_sql(sel, dm)
    except (StopIteration, KeyError):
        raise HTTPException(400, "selection does not exist in the data model")
    r17, r4_2 = execute_queries(WS.con, r16)
    return {"r15_selection": sel, "r16_queries": r16, "r17_result": r17, "r4_quality": r4_2}


# ------------------------------------------------------------------ process 4
class EditReq(BaseModel):
    r13_data_model: dict


@app.post("/api/process4")
def process4(req: EditReq):
    _need(WS.r13_versions, "build the data model first")
    with WS.lock:
        try:
            dm = M.validate_data_model(copy.deepcopy(req.r13_data_model), WS.r13_versions[0])
        except (ValueError, KeyError) as e:
            raise HTTPException(400, str(e))
        for r in dm["relationships"]:
            r["id"] = f'{r["from_table"]}.{r["from_column"]}->{r["to_table"]}.{r["to_column"]}'
        dm["version"] = len(WS.r13_versions) + 1
        r19, card = M.assign_rule_keys_for_model(dm)
        cols = M.model_columns(dm)
        r20 = WS.model_2.predict(cols)
        dm = M.apply_labels_to_model(dm, r19, r20, card)
        WS.r13_versions.append(dm)
    disagreements = [cid for cid in r19 if r19[cid] != r20[cid]["label"]]
    return {"r13_data_model": dm, "r13_versions": len(WS.r13_versions), "r19_rule_keys": r19,
            "r19_cardinality": card, "r20_model_keys": r20, "disagreements": disagreements}


@app.post("/api/process4/revert/{version}")
def revert(version: int):
    _need(1 <= version <= len(WS.r13_versions), "no such version")
    dm = copy.deepcopy(WS.r13_versions[version - 1])
    dm["version"] = len(WS.r13_versions) + 1
    WS.r13_versions.append(dm)
    return {"r13_data_model": dm, "r13_versions": len(WS.r13_versions)}


# ------------------------------------------------------------------ process 5
class TrainReq(BaseModel):
    r12_labels: dict[str, str]   # r12_2: the full, human-corrected label collection


@app.post("/api/process5")
def process5(req: TrainReq):
    _need(WS.p2, "build the data model first")
    r8 = WS.p2["r8"]
    labels = req.r12_labels
    _need(set(labels) == {c["id"] for c in r8}, "labels must cover every column")
    _need(all(v in KEY_ROLES for v in labels.values()), f"labels must be one of {KEY_ROLES}")
    with WS.lock:
        WS.r22_tree = WS.model_2.train(r8, labels, source="human-corrected labels (r12_2)")
        WS.p2["r12"] = {cid: {"label": lab, "confidence": 1.0} for cid, lab in labels.items()}
        refit = WS.model_2.predict(r8)
    return {"r22_tree": WS.r22_tree, "r12_model_keys": WS.p2["r12"],
            "training_fit": sum(refit[c]["label"] == labels[c] for c in labels) / len(labels)}


# ------------------------------------------------------------------ static frontend
app.mount("/static", StaticFiles(directory=ROOT / "frontend"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "frontend" / "index.html")
