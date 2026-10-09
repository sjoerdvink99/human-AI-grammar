"""End-to-end tests of the five processes (model_1 is stubbed so tests are offline)."""
import pytest
from fastapi.testclient import TestClient

from backend import app as appmod
from backend import modeling
from backend.model_provider import ModelError


@pytest.fixture()
def client(monkeypatch):
    def fake_model(prompt, **kw):
        # mix of valid labels, one invalid label and missing ids to exercise validation
        return {"customers.customer_id": "identifier", "customers.city": "category", "orders.status": "bogus"}
    monkeypatch.setattr(modeling, "call_model_json", fake_model)
    appmod.WS.__init__()
    c = TestClient(appmod.app)
    c.post("/api/sample")
    return c


def build(c):
    p1 = c.post("/api/process1", json={"initial_sample": 20}).json()
    p2 = c.post("/api/process2").json()
    return p1, p2


def test_process1_loop_settles(client):
    p1, _ = build(client)
    assert len(p1["rounds"]) > 1, "sample should have been expanded at least once"
    assert all(q["stable"] for q in p1["r4_quality"])


def test_process2_data_model(client):
    _, p2 = build(client)
    assert set(p2["r7_semantic_types"].values()) <= set(modeling.SEMANTIC_TYPES)
    assert "orders.status" in p2["model_1"]["fallback_used"]
    dm = p2["r13_data_model"]
    pks = {e["name"]: e["primary_key"] for e in dm["entities"]}
    assert pks == {"customers": "customer_id", "orders": "order_id", "products": "sku", "order_items": "item_id"}
    rels = {r["id"] for r in dm["relationships"]}
    assert "orders.customer_id->customers.customer_id" in rels
    assert "order_items.sku->products.sku" in rels


def test_process3_relationship_and_entity(client):
    _, p2 = build(client)
    rel = p2["r13_data_model"]["relationships"][0]["id"]
    r = client.post("/api/process3", json={"r15_selection": {"kind": "relationship", "id": rel}}).json()
    assert r["r17_result"]["rows"] and any("orphan" in c["check"] for c in r["r4_quality"])
    r = client.post("/api/process3", json={"r15_selection": {"kind": "entity", "id": "orders", "column": "status"}}).json()
    assert r["r17_result"]["title"].endswith("orders.status")


def test_process4_edit_and_relabel(client):
    _, p2 = build(client)
    dm = p2["r13_data_model"]
    dm["relationships"] = [r for r in dm["relationships"] if r["from_column"] != "sku"]
    r = client.post("/api/process4", json={"r13_data_model": dm}).json()
    assert r["r13_versions"] == 2
    assert r["r19_rule_keys"]["order_items.sku"] == "attribute"
    assert "order_items.sku" in r["disagreements"]
    bad = dict(dm, relationships=[{"from_table": "orders", "from_column": "nope", "to_table": "customers", "to_column": "customer_id"}])
    assert client.post("/api/process4", json={"r13_data_model": bad}).status_code == 400


def test_process5_retrain(client):
    _, p2 = build(client)
    labels = {k: v["label"] for k, v in p2["r12_model_keys"].items()}
    labels["order_items.item_id"] = "attribute"
    r = client.post("/api/process5", json={"r12_labels": labels}).json()
    assert r["r22_tree"]["trained_on"].startswith("human")
    assert r["r22_tree"]["nodes"]
    assert client.post("/api/process5", json={"r12_labels": {"x": "y"}}).status_code == 400


def test_model_failure_falls_back(monkeypatch):
    def broken(prompt, **kw):
        raise ModelError("offline")
    monkeypatch.setattr(modeling, "call_model_json", broken)
    appmod.WS.__init__()
    c = TestClient(appmod.app)
    c.post("/api/sample")
    c.post("/api/process1", json={})
    p2 = c.post("/api/process2").json()
    assert p2["model_1"]["error"] == "offline"
    assert p2["r13_data_model"]["relationships"]
