"""HTTP server: JSON API for the five processes + static frontend.

Run:  python3 backend/server.py   (then open http://localhost:8000)
"""
import glob
import json
import mimetypes
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))

from llm import ModelError  # noqa: E402
from p1_sampling import run_process1  # noqa: E402
from p2_profile import run_process2  # noqa: E402
from p3_validation import run_process3  # noqa: E402
from p4_refine import EditError, run_process4  # noqa: E402
from p5_training import (CLASSIFIER_PATH, TrainingError, apply_corrections, load_classifier,  # noqa: E402
                         train_table_classifier)
from store import Store  # noqa: E402
from taxonomy import SEMANTIC_TYPES, TABLE_FEATURES, TABLE_TYPES  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB = os.path.join(ROOT, "web")
SAMPLE_DIR = os.path.join(ROOT, "data", "sample")
UPLOAD_DIR = os.path.join(ROOT, "data", "uploads")


class Session:
    """All representations of the design, held for one user session."""

    def __init__(self):
        self.store = Store()
        self.p1 = None          # samples_1, detected_features_1, rounds (counterexamples_1)
        self.p2 = None          # column_attributes_1 … table_types_1, semantic_profile_1
        self.profiles = []      # semantic_profile_1, _2, … (all versions kept for compare / revert)
        self.current = None     # index into profiles
        self.p4 = None          # refined_table_labels_1, refined_table_types_1 of the last edit
        self.validation = None  # last process-3 result
        self.table_types_2 = None
        self.classifier = load_classifier()
        self.log, self.busy = [], False
        self.lock = threading.Lock()

    def progress(self, msg):
        self.log.append(msg)
        print("  ·", msg, flush=True)

    def reset_results(self):
        self.p1 = self.p2 = self.p4 = self.validation = self.table_types_2 = None
        self.profiles, self.current = [], None

    def state(self):
        return {
            "tables": list(self.store.tables.values()),
            "p1": self.p1, "p2": self.p2, "p4": self.p4,
            "profiles": self.profiles,  # every version, so views can compare and revert
            "semantic_profile": self.profiles[self.current] if self.current is not None else None,
            "table_types_2": self.table_types_2, "classifier": self.classifier,
            "taxonomy": {"semantic_types": SEMANTIC_TYPES, "table_types": TABLE_TYPES,
                         "table_features": TABLE_FEATURES},
        }


S = Session()


def _busy(fn):
    """Run a long operation with the progress log; one at a time."""
    if not S.lock.acquire(blocking=False):
        raise RuntimeError("another operation is running")
    S.busy, S.log = True, []
    try:
        return fn()
    finally:
        S.busy = False
        S.lock.release()


def do_process1():
    tables = list(S.store.tables)
    if not tables:
        raise ValueError("load some tables first")
    S.reset_results()
    S.p1 = run_process1(S.store, tables, S.progress)


def do_process2():
    if not S.p1:
        raise ValueError("run process 1 first")
    S.p2 = run_process2(S.store, list(S.store.tables), S.p1["detected_features"], S.classifier, S.progress)
    S.profiles = [S.p2["semantic_profile"]]
    S.current, S.p4, S.table_types_2, S.validation = 0, None, None, None


def api(method, path, body, query):
    if path == "/api/state" and method == "GET":
        return S.state()
    if path == "/api/progress":
        return {"busy": S.busy, "log": S.log}
    if path == "/api/tables/preview":
        name = query.get("name", [""])[0]
        if name not in S.store.tables:
            raise ValueError("unknown table")
        return S.store.preview(name, int(query.get("limit", ["100"])[0]))
    if method != "POST":
        raise LookupError(path)
    if path == "/api/tables/sample":
        for f in sorted(glob.glob(os.path.join(SAMPLE_DIR, "*.csv"))):
            S.store.load_csv(f)
        S.reset_results()
        return S.state()
    if path == "/api/tables/upload":
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        name = S.store.sanitize(body["name"])
        p = os.path.join(UPLOAD_DIR, name + ".csv")
        with open(p, "w") as f:
            f.write(body["csv"])
        S.store.load_csv(p, name)
        S.reset_results()
        return S.state()
    if path == "/api/tables/remove":
        S.store.drop(body["name"])
        S.reset_results()
        return S.state()
    if path == "/api/tables/clear":
        for t in list(S.store.tables):
            S.store.drop(t)
        S.reset_results()
        return S.state()
    if path == "/api/process1":          # process 1, then process 2 continues from it
        def run():
            do_process1()
            if body.get("continue", True):
                do_process2()
        _busy(run)
        return S.state()
    if path == "/api/process2":
        _busy(do_process2)
        return S.state()
    if path == "/api/process3":
        if S.current is None:
            raise ValueError("no semantic profile yet")
        S.validation = run_process3(S.store, body["selected_feature"])
        return S.validation
    if path == "/api/process4":
        if S.current is None:
            raise ValueError("no semantic profile yet")
        base = S.profiles[S.current]

        def run():
            S.p4 = run_process4(body["semantic_profile"], base, len(S.profiles) + 1, S.classifier, S.progress)
            S.profiles.append(S.p4["semantic_profile"])
            S.current = len(S.profiles) - 1
        _busy(run)
        return S.state()
    if path == "/api/profile/select":
        v = int(body["version"])
        S.current = next(i for i, p in enumerate(S.profiles) if p["version"] == v)
        return S.state()
    if path == "/api/process5/train":
        if not S.p2:
            raise ValueError("run process 2 first")

        def run():
            S.progress("[human modify] table_types_2")
            S.table_types_2 = apply_corrections(S.p2["table_types"], body["corrections"])
            S.classifier = train_table_classifier(S.p2["column_semantics"], S.p2["table_labels"],
                                                  S.table_types_2, S.progress)
        _busy(run)
        return S.state()
    if path == "/api/classifier/reset":
        if os.path.exists(CLASSIFIER_PATH):
            os.remove(CLASSIFIER_PATH)
        S.classifier = None
        return S.state()
    raise LookupError(path)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, payload, ctype="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, method):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            body = {}
            if method == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
            try:
                self._send(200, api(method, url.path, body, parse_qs(url.query)))
            except LookupError as e:
                self._send(404, {"error": f"not found: {e}"})
            except (ValueError, EditError, TrainingError, ModelError, RuntimeError) as e:
                traceback.print_exc()
                self._send(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                self._send(500, {"error": f"{type(e).__name__}: {e}"})
            return
        rel = "index.html" if url.path in ("/", "") else url.path.lstrip("/")
        full = os.path.abspath(os.path.join(WEB, rel))
        if not full.startswith(WEB) or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain")
        with open(full, "rb") as f:
            self._send(200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def main():
    port = int(os.environ.get("PORT", "8000"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"System X running on http://localhost:{port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
