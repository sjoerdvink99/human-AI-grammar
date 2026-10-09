"""Run: python3 -m unittest discover -s tests"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import diffing  # noqa: E402
import pipeline_generate  # noqa: E402
import repair_model  # noqa: E402
from llm import extract_json  # noqa: E402
from metrics import evaluate_rendering  # noqa: E402
from mutations import OPERATOR_KEYS, apply_operator  # noqa: E402
from render import CodeError, execute_code, validate_code  # noqa: E402

BAR = """import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(4, 3))
ax.bar(["a very long category name", "another very long category", "and a third long one"], [1, 2, 3])
"""


class TestDiffing(unittest.TestCase):
    old = "a\nb\nc\nd\n"
    new = "a\nB\nc\nd\ne\n"

    def test_extract(self):
        hunks = diffing.extract_hunks(self.old, self.new)
        self.assertEqual(len(hunks), 2)
        self.assertEqual(hunks[0]["new_lines"], ["B"])

    def test_apply_subsets(self):
        self.assertEqual(diffing.apply_hunks(self.old, self.new, []), self.old)
        self.assertEqual(diffing.apply_hunks(self.old, self.new, [0, 1]), self.new)
        self.assertEqual(diffing.apply_hunks(self.old, self.new, [1]), "a\nb\nc\nd\ne\n")


class TestValidation(unittest.TestCase):
    def test_rejects_os(self):
        with self.assertRaises(CodeError):
            validate_code("import os\nos.system('ls')")
        with self.assertRaises(CodeError):
            validate_code("open('x')")

    def test_chart_type_enforced(self):
        with self.assertRaises(CodeError):
            pipeline_generate.check_program(BAR, "pie")
        pipeline_generate.check_program(BAR, "bar")

    def test_extract_json(self):
        self.assertEqual(extract_json('text ```json\n{"code": "x"}\n``` more'), {"code": "x"})


class TestRenderAndMetrics(unittest.TestCase):
    def test_overlap_detected_and_repaired(self):
        before = evaluate_rendering(execute_code(BAR))
        self.assertTrue(before["ok"])
        self.assertGreater(before["metrics"]["text_overlap"], 0)
        after = evaluate_rendering(execute_code(apply_operator(BAR, "rotate_xticks")))
        self.assertLess(after["metrics"]["text_overlap"], before["metrics"]["text_overlap"])

    def test_all_operators_run(self):
        for op in OPERATOR_KEYS:
            self.assertTrue(execute_code(apply_operator(BAR, op))["ok"], op)


class TestTrain(unittest.TestCase):
    def test_train_and_predict(self):
        m = {"text_overlap": 0.5, "clipped_text": 0, "small_text": 0, "legend_occlusion": 0,
             "whitespace": 0, "missing_labels": 0}
        recs = [{"operator": "rotate_xticks", "before": {"metrics": m}, "delta": 15.0}]
        old = repair_model.WEIGHTS_PATH
        repair_model.WEIGHTS_PATH = os.path.join(repair_model.DATA_DIR, "_test_weights.json")
        try:
            r9 = repair_model.train(recs)
            gains = repair_model.predict(r9, m)
            self.assertEqual(gains[0]["operator"], "rotate_xticks")
            self.assertGreater(gains[0]["predicted_gain"], 5)
        finally:
            os.remove(repair_model.WEIGHTS_PATH)
            repair_model.WEIGHTS_PATH = old


if __name__ == "__main__":
    unittest.main()
