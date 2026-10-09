"""FastAPI application: HTTP endpoints for the five processes and the static frontend."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .demo_data import build_demo
from .detection import run_detection, sample_rows
from .enrichment import STAGES, run_stage
from .refine import EditError, correct_table_type, refine
from .store import WS
from .table_classifier import TABLE_LABELS, TABLE_TYPES, TableClassifier
from .taxonomy import TAXONOMY
from .validation import build_queries, execute_queries

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="System X — semantic enrichment")
CLASSIFIER = TableClassifier()


def _bad(e: Exception):
    raise HTTPException(status_code=400, detail=str(e))


def state() -> dict:
    return {
        "tables": [WS.preview(t, 15) for t in WS.table_names],
        "detection": WS.detection,
        "stages_done": WS.stages_done,
        "stages": STAGES,
        "column_semantics": WS.column_semantics,
        "key_relations": WS.key_relations,
        "functional_dependencies": WS.functional_dependencies,
        "table_labels": WS.table_labels,
        "table_types": WS.table_types,
        "semantic_profile": WS.profile,
        "profile_versions": [{"version": p["version"], "edits": p.get("edits", [])} for p in WS.profiles],
        "classifier": CLASSIFIER.graph(),
        "vocab": {"taxonomy": TAXONOMY, "table_types": TABLE_TYPES, "table_labels": TABLE_LABELS},
    }


@app.get("/api/state")
def get_state():
    return state()


# ---------------------------------------------------------------- tables_1 (upload)
@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...), replace: bool = True):
    if replace:
        WS.reset()
    try:
        for f in files:
            if not f.filename.lower().endswith((".csv", ".tsv", ".txt")):
                raise ValueError(f"{f.filename}: only CSV files are supported")
            WS.add_csv(f.filename, await f.read())
    except Exception as e:
        _bad(e)
    return state()


@app.post("/api/demo")
def load_demo():
    WS.reset()
    for name, df in build_demo().items():
        WS.add_csv(name, df.to_csv(index=False).encode())
    return state()


# ---------------------------------------------------------------- process 1
class DetectRequest(BaseModel):
    sample_size: int = 200
    max_iterations: int = 5


@app.post("/api/detect")
def detect(req: DetectRequest):
    if not WS.table_names:
        _bad(ValueError("upload tables first"))
    WS.detection = run_detection(WS, max(10, req.sample_size), max(1, min(20, req.max_iterations)))
    # downstream representations depend on the detected features: invalidate them
    WS.stages_done = []
    return state()


@app.get("/api/samples/{table}")
def samples(table: str):
    if table not in WS.table_names:
        raise HTTPException(404, "unknown table")
    return {"rows": sample_rows(WS, table, 100)}


# ---------------------------------------------------------------- process 2
@app.post("/api/enrich/{stage}")
def enrich(stage: str):
    if stage not in STAGES:
        raise HTTPException(404, f"unknown stage {stage}")
    try:
        run_stage(WS, stage, CLASSIFIER)
    except ValueError as e:
        _bad(e)
    return state()


# ---------------------------------------------------------------- process 3
class InspectRequest(BaseModel):
    selected_feature: dict


@app.post("/api/inspect")
def inspect(req: InspectRequest):
    if WS.profile is None:
        _bad(ValueError("no semantic profile yet"))
    try:
        queries = build_queries(req.selected_feature, WS.profile)
    except (ValueError, KeyError) as e:
        _bad(e)
    result = execute_queries(WS, req.selected_feature, queries)
    return {"selected_feature": req.selected_feature, "validation_queries": queries, **result}


# ---------------------------------------------------------------- process 4
class RefineRequest(BaseModel):
    edits: list[dict]


@app.post("/api/refine")
def refine_profile(req: RefineRequest):
    try:
        refine(WS, req.edits, CLASSIFIER)
    except (EditError, KeyError) as e:
        _bad(e)
    return state()


# ---------------------------------------------------------------- process 5
class CorrectionRequest(BaseModel):
    table: str
    table_type: str


@app.post("/api/table-type")
def table_type(req: CorrectionRequest):
    try:
        correct_table_type(WS, req.table, req.table_type, CLASSIFIER)
    except EditError as e:
        _bad(e)
    return state()


@app.post("/api/classifier/reset")
def classifier_reset():
    CLASSIFIER.reset()
    WS.type_overrides.clear()
    return state()


# ---------------------------------------------------------------- frontend
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")
