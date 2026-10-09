"""HTTP server (stdlib only). Run: python3 backend/server.py [port]"""
from __future__ import annotations

import json
import mimetypes
import os
import sys
import threading
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import corpus  # noqa: E402
import diffing  # noqa: E402
import pipeline_generate  # noqa: E402
import pipeline_repair  # noqa: E402
import pipeline_train  # noqa: E402
import repair_model  # noqa: E402
from metrics import METRICS  # noqa: E402
from mutations import OPERATORS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")

JOBS: dict[str, dict] = {}
SESSIONS: dict[str, dict] = {}
LAST_TRAINING: dict = {}
LOCK = threading.Lock()


def start_job(fn) -> str:
    jid = uuid.uuid4().hex[:12]
    job = {"id": jid, "stages": [], "done": False, "error": None, "result": None}
    JOBS[jid] = job

    def progress(stage, info=None):
        with LOCK:
            job["stages"].append({"stage": stage, "info": info})

    def runner():
        try:
            job["result"] = fn(progress)
        except Exception as e:  # surfaced to the UI
            traceback.print_exc()
            job["error"] = str(e)
        finally:
            job["done"] = True

    threading.Thread(target=runner, daemon=True).start()
    return jid


def train_job(progress):
    res = pipeline_train.run(progress)
    LAST_TRAINING.clear()
    LAST_TRAINING.update(res)
    return res


def create_job(request: str, chart_type: str):
    def fn(progress):
        sid = uuid.uuid4().hex[:12]
        progress("model_1 generate")
        r12_1 = pipeline_generate.generate(request, chart_type)
        SESSIONS[sid] = {"r10": request, "r11": chart_type, "r12_1": r12_1}
        res = pipeline_repair.run_repair(r12_1, progress)
        SESSIONS[sid].update(res)
        return {"session_id": sid, "r10": request, "r11": chart_type, **res}
    return fn


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if "/api/jobs/" not in self.path:
            sys.stderr.write("%s\n" % (fmt % args))

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        url = urlparse(self.path)
        p = url.path
        if p == "/api/meta":
            return self._json({
                "chart_types": [{"value": k, "label": v[0]} for k, v in pipeline_generate.CHART_TYPES.items()],
                "metrics": [{"key": k, "label": lbl, "weight": w} for k, lbl, w in METRICS],
                "operators": [{"key": k, "description": v[0]} for k, v in OPERATORS.items()],
            })
        if p == "/api/corpus":
            return self._json(corpus.list_scripts())
        if p == "/api/model":
            return self._json({"r9": repair_model.load(), "last_training": LAST_TRAINING or None})
        if p.startswith("/api/jobs/"):
            job = JOBS.get(p.rsplit("/", 1)[-1])
            return self._json(job) if job else self._json({"error": "no such job"}, 404)
        # static files
        rel = "index.html" if p in ("/", "") else p.lstrip("/")
        path = os.path.normpath(os.path.join(FRONTEND, rel))
        if not path.startswith(FRONTEND) or not os.path.isfile(path):
            return self._json({"error": "not found"}, 404)
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_DELETE(self):
        url = urlparse(self.path)
        if url.path == "/api/corpus":
            try:
                corpus.delete_script(parse_qs(url.query).get("id", [""])[0])
                return self._json({"ok": True})
            except Exception as e:
                return self._json({"error": str(e)}, 400)
        return self._json({"error": "not found"}, 404)

    def do_POST(self):
        p = urlparse(self.path).path
        try:
            body = self._body()
            if p == "/api/corpus":
                return self._json(corpus.add_script(body.get("title", "Untitled"), body.get("code", "")))
            if p == "/api/train":
                return self._json({"job_id": start_job(train_job)})
            if p == "/api/create":
                req, ct = body.get("request", ""), body.get("chart_type", "")
                if not req.strip():
                    raise ValueError("Describe the chart you want (r10).")
                if ct not in pipeline_generate.CHART_TYPES:
                    raise ValueError("Pick a chart type (r11).")
                if repair_model.load() is None:
                    raise ValueError("Train the repair model first (process 1).")
                return self._json({"job_id": start_job(create_job(req, ct))})
            if p == "/api/apply":
                s = SESSIONS.get(body.get("session_id"))
                if not s:
                    raise ValueError("Unknown session.")
                r19 = [int(i) for i in body.get("hunk_ids", [])]
                r12_3 = pipeline_repair.apply_selection(s["r12_1"], s["r12_2"], r19)
                s["r19"], s["r12_3"] = r19, r12_3
                r20 = pipeline_repair.translate(r12_3)  # process 4 follows immediately
                s.update(r20)
                return self._json({"r19": r19, "r12_3": r12_3,
                                   "diff": diffing.unified(s["r12_1"], r12_3), **r20})
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 400)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8811))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"System X running on http://127.0.0.1:{port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
