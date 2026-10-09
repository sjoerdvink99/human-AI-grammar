"""End-to-end walk through all four processes against a running server (uses the real model CLI).
Run: python3 tests/e2e.py [base_url]"""
import json
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8811"


def call(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)


def wait(job_id):
    while True:
        j = call(f"/api/jobs/{job_id}")
        if j["done"]:
            if j["error"]:
                raise SystemExit(f"job failed: {j['error']}")
            print("  stages:", [s["stage"] for s in j["stages"]])
            return j["result"]
        time.sleep(2)


print("process 1: train")
res = wait(call("/api/train", {})["job_id"])
print(f"  r7={res['n_r7']} r8={res['n_r8']} r9 support={res['r9']['support']}")

print("process 2+3: generate and repair")
res = wait(call("/api/create", {"request": "Number of software engineers at the ten largest tech companies, "
                                "using their full legal company names", "chart_type": "bar"})["job_id"])
print("  r14 score", res["r14"]["score"], "-> r16 score", res["r16"]["score"], "r17", res["r17"]["score_delta"])
print("  r18 hunks:", len(res["r18"]), "rationale:", res["rationale"])
keep = [h["id"] for h in res["r18"]][: max(1, len(res["r18"]) - 1)]
print("process 3 human select + tool_5 modify, process 4 translate; keeping hunks", keep)
out = call("/api/apply", {"session_id": res["session_id"], "hunk_ids": keep})
print("  r12_3 lines:", len(out["r12_3"].splitlines()), "r20 svg bytes:", len(out["r20_svg"]))
print(out["diff"])
