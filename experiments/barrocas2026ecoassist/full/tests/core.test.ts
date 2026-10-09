import { describe, expect, it } from "vitest";
import { applySelected, extractDiff } from "../shared/diff.ts";
import { toPreviewDocument } from "../shared/preview.ts";
import { ruleOptimize } from "../server/tools/ruleOptimizer.ts";
import { selectPairs } from "../server/train/pipeline.ts";
import { parseJsonReply } from "../server/llm.ts";
import { validateWebCode } from "../server/models.ts";
import type { TrainingPair } from "../shared/types.ts";

const a = { html: "<html><body>\n<p>a</p>\n</body></html>\n", css: "a{}\nb{}\nc{}\n", js: "one();\ntwo();\nthree();\n" };
const b = { html: a.html, css: "a{}\nB{}\nc{}\n", js: "one();\nTWO();\nthree();\nfour();\n" };

describe("diff (tool_5 extract / modify)", () => {
  it("extracts one hunk per changed block", () => {
    const d = extractDiff(a, b);
    expect(d.hunks.map((h) => h.id)).toEqual(["css-0", "js-0", "js-1"]);
    expect(d.hunks[0]).toMatchObject({ removed: ["b{}"], added: ["B{}"], oldStart: 2 });
  });
  it("applies all, none, or a subset of hunks", () => {
    const ids = extractDiff(a, b).hunks.map((h) => h.id);
    expect(applySelected(a, b, ids)).toEqual(b);
    expect(applySelected(a, b, [])).toEqual(a);
    expect(applySelected(a, b, ["js-1"]).js).toBe("one();\ntwo();\nthree();\nfour();\n");
  });
});

describe("preview (tool_5 translate)", () => {
  it("inlines linked css and js", () => {
    const doc = toPreviewDocument({ html: '<html><head><link rel="stylesheet" href="style.css"></head><body><script src="script.js"></script></body></html>', css: "p{}", js: "x()" });
    expect(doc).toContain("<style>\np{}\n</style>");
    expect(doc).toContain("<script>\nx()\n</script>");
  });
});

describe("rule toolchain (tool_3)", () => {
  it("clamps fast timers, removes will-change, minifies", async () => {
    const r = await ruleOptimize({ html: "<html><body><img src=x.png></body></html>", css: ".a {\n  will-change: transform;\n  color: red;\n}\n", js: "setInterval(function(){ tick(); }, 1);" });
    expect(r.applied).toEqual(expect.arrayContaining(["clamp-fast-timers", "remove-blanket-will-change", "lazy-images", "terser", "lightningcss"]));
    expect(r.readable.js).toContain(", 16)");
    expect(r.code.css).not.toContain("will-change");
  });
});

describe("tool_4 select", () => {
  it("keeps only pairs that saved energy and still work", () => {
    const base = { savings: { joules: 1, percent: 10 }, visualMismatch: 0, consoleErrors: [] } as unknown as TrainingPair;
    const pairs = [base, { ...base, savings: { joules: -1, percent: -5 } }, { ...base, visualMismatch: 0.5 }, { ...base, consoleErrors: ["x"] }];
    expect(selectPairs(pairs)).toHaveLength(1);
  });
});

describe("model output validation", () => {
  it("parses fenced JSON and validates fields", () => {
    const c = validateWebCode(parseJsonReply('Here:\n```json\n{"html":"<!doctype html><html></html>","css":"","js":""}\n```'));
    expect(c.css).toBe("");
    expect(() => validateWebCode({ html: "<html>" })).toThrow();
  });
});
