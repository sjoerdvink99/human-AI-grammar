"""Tests for the deterministic (tool) steps. Model steps are exercised with a stub.

Run: python3 -m unittest discover -s tests
"""
import glob
import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import p2_profile as p2  # noqa: E402
from p1_sampling import run_process1  # noqa: E402
from p3_validation import run_process3  # noqa: E402
from p4_refine import EditError, normalize_edited_profile  # noqa: E402
from p5_training import TrainingError, predict, validate_tree  # noqa: E402
from store import Store  # noqa: E402


def stub_predictions(attrs):
    return [{"table": a["table"], "column": a["column"], "semantic_type": "unknown", "confidence": 0,
             "rationale": "", "valid": True} for a in attrs]


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = Store()
        for f in sorted(glob.glob(os.path.join(ROOT, "data", "sample", "*.csv"))):
            cls.s.load_csv(f)
        cls.tables = list(cls.s.tables)
        cls.p1 = run_process1(cls.s, cls.tables, lambda m: None)
        attrs = p2.extract_column_attributes(cls.s, cls.tables, cls.p1["detected_features"])
        rules = p2.assign_rule_taxonomies(attrs)
        cls.sem = p2.compose_column_semantics(attrs, rules, stub_predictions(attrs))
        cls.keys = p2.extract_key_relations(cls.s, cls.tables, cls.sem)
        cls.fds = p2.extract_functional_dependencies(cls.s, cls.tables, cls.sem, cls.keys)
        n_rows = {t: cls.s.tables[t]["n_rows"] for t in cls.tables}
        cls.labels = p2.assign_table_labels(cls.sem, cls.keys, cls.fds, n_rows)
        types = [{"table": l["table"], "table_type": l["label"], "confidence": 1, "rationale": ""} for l in cls.labels]
        cls.profile = p2.compose_semantic_profile(cls.sem, cls.keys, cls.fds, cls.labels, types, n_rows)

    def test_sampling_loop_converges(self):
        last = self.p1["rounds"][-1]
        self.assertGreater(len(self.p1["rounds"]), 1, "planted dirt should trigger an expansion")
        self.assertEqual(last["counterexamples"], [])
        self.assertTrue(all(f["status"] == "holds" for f in self.p1["detected_features"]))

    def test_foreign_keys(self):
        fks = {(e["from_table"], e["from_column"], e["to_table"]) for e in self.keys["edges"]}
        self.assertIn(("orders", "customer_id", "customers"), fks)
        self.assertIn(("order_items", "product_id", "products"), fks)
        self.assertIn(("orders", "ship_country", "countries"), fks)
        self.assertNotIn(("order_items", "product_id", "customers"), fks)

    def test_fd_and_labels(self):
        self.assertIn("fd:customers.city->country_code", {e["id"] for e in self.fds["edges"]})
        lab = {l["table"]: l["label"] for l in self.labels}
        self.assertEqual(lab["order_items"], "fact")
        self.assertEqual(lab["countries"], "lookup")

    def test_validation_finds_dirty_email(self):
        r = run_process3(self.s, {"kind": "column_type", "table": "customers", "column": "email",
                                  "semantic_type": "email"})
        self.assertEqual(r["counterexamples"]["count"], 2)
        self.assertEqual(len(r["validation_queries"]), 2)

    def test_edit_validation(self):
        bad = {"tables": [{"name": "orders", "primary_key": "order_id",
                           "columns": [{"column": "status", "semantic_type": "not-a-type"}]}]}
        with self.assertRaises(EditError):
            normalize_edited_profile(bad, self.profile)

    def test_tree_validation(self):
        tree = {"root": "a", "nodes": [{"id": "a", "feature": "n_fk_out", "op": ">=", "threshold": 2, "yes": "f", "no": "d"},
                                       {"id": "f", "label": "fact"}, {"id": "d", "label": "dimension"}]}
        validate_tree(tree)
        self.assertEqual(predict(tree, {"n_fk_out": 3}), "fact")
        with self.assertRaises(TrainingError):
            validate_tree({"root": "a", "nodes": [{"id": "a", "label": "spaceship"}]})


if __name__ == "__main__":
    unittest.main()
