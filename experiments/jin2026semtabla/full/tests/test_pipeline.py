"""End-to-end tests of the five processes. model_1 is replaced by a deterministic stub
(SYSTEMX_FAKE_MODEL) so the tests do not call the Claude CLI."""
import json
import os

import pytest

os.environ["SYSTEMX_FAKE_MODEL"] = json.dumps({"columns": [
    {"key": "products.unit_price", "category": "monetary", "confidence": 0.9, "rationale": "price"},
    {"key": "orders.total_amount", "category": "monetary", "confidence": 0.9, "rationale": "amount"},
    {"key": "customers.first_name", "category": "not-a-category", "confidence": 0.9, "rationale": "x"},
]})

from fastapi.testclient import TestClient  # noqa: E402

from backend import app as app_module  # noqa: E402
from backend.table_classifier import TableClassifier  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    app_module.CLASSIFIER = TableClassifier(tmp_path_factory.mktemp("clf") / "corrections.json")
    c = TestClient(app_module.app)
    c.post("/api/demo")
    return c


def test_process1_detection_loop_removes_refuted_features(client):
    s = client.post("/api/detect", json={"sample_size": 200, "max_iterations": 5}).json()
    d = s["detection"]
    assert d["converged"]
    ids = {f["id"] for f in d["detected_features"]}
    refuted = {r["feature"]["id"] for r in d["refuted_features"]}
    assert "unique:orders(order_ref)" in refuted          # planted duplicate found on full data
    assert "unique:orders(order_ref)" not in ids
    assert "unique:customers(customer_id)" in ids
    assert ids.isdisjoint(refuted)
    assert d["log"][-1]["counterexamples"] == []


def test_process2_stages_in_order(client):
    r = client.post("/api/enrich/keys")
    assert r.status_code == 400  # attributes first
    for st in ["attributes", "keys", "dependencies", "tables"]:
        assert client.post(f"/api/enrich/{st}").status_code == 200
    s = client.get("/api/state").json()
    p = s["semantic_profile"]
    cols = {c["key"]: c for c in p["columns"]}
    assert cols["customers.email"]["category"] == "email" and cols["customers.email"]["source"] == "rule"
    assert cols["products.unit_price"]["source"] == "model"
    assert cols["customers.first_name"]["category"] == "other"  # invalid model output rejected
    tables = {t["name"]: t for t in p["tables"]}
    assert tables["customers"]["primary_key"] == ["customer_id"]
    assert tables["order_items"]["primary_key"] == ["order_id", "line_no"]
    assert all(t["type"] in s["vocab"]["table_types"] for t in p["tables"])
    assert any(f["from_table"] == "order_items" and f["to_table"] == "orders" for f in p["foreign_keys"])


def test_process3_inspect_foreign_key_and_fd(client):
    r = client.post("/api/inspect", json={"selected_feature": {
        "kind": "foreign_key", "from_table": "orders", "from_column": "customer_id",
        "to_table": "customers", "to_column": "customer_id"}}).json()
    assert r["counterexamples"]["total"] == 3
    assert r["supporting_samples"]["total"] == 2497
    assert all("sql" in q for q in r["validation_queries"])
    r = client.post("/api/inspect", json={"selected_feature": {
        "kind": "fd", "table": "orders", "lhs": "store_id", "rhs": "store_city"}}).json()
    assert r["counterexamples"]["total"] > 0
    r = client.post("/api/inspect", json={"selected_feature": {"kind": "column", "table": "customers", "column": "email"}}).json()
    assert r["counterexamples"]["total"] == 2


def test_process4_refine_creates_new_version(client):
    s = client.post("/api/refine", json={"edits": [
        {"op": "add_foreign_key", "from_table": "orders", "from_column": "customer_id", "to_table": "customers", "to_column": "customer_id"},
        {"op": "set_taxonomy", "table": "orders", "column": "status", "category": "categorical_code"},
    ]}).json()
    p = s["semantic_profile"]
    assert p["version"] == 2 and len(s["profile_versions"]) == 2
    orders = next(t for t in p["tables"] if t["name"] == "orders")
    assert "references_one" in orders["labels"] or "references_many" in orders["labels"]
    assert client.post("/api/refine", json={"edits": [{"op": "set_taxonomy", "table": "orders", "column": "status", "category": "bogus"}]}).status_code == 400


def test_process5_correction_retrains_classifier(client):
    before = client.get("/api/state").json()["classifier"]["version"]
    s = client.post("/api/table-type", json={"table": "products", "table_type": "entity"}).json()
    assert s["classifier"]["version"] == before + 1
    assert s["classifier"]["corrections"][-1]["type"] == "entity"
    products = next(t for t in s["semantic_profile"]["tables"] if t["name"] == "products")
    assert products["type"] == "entity" and products["type_source"] == "user"
    pred = app_module.CLASSIFIER.predict({"products": products["labels"]})
    assert pred["products"]["type"] == "entity"
