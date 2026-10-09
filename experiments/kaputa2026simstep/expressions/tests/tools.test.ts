import { test, after } from "node:test";
import assert from "node:assert/strict";
import { applyGraphChanges } from "../src/lib/graphDiff";
import { extractHtml, extractJson, extractSvg } from "../server/model";
import { closeBrowser, loadAndCollectErrors, runTests } from "../server/headless";

after(() => closeBrowser());

test("applyGraphChanges adds, updates, removes and flags nodes", () => {
  const g = {
    nodes: [
      { id: "a", label: "A", description: "", kind: "control" },
      { id: "b", label: "B", description: "", kind: "display" },
    ],
    edges: [{ source: "a", target: "b", label: "sets" }],
  };
  const out = applyGraphChanges(
    g,
    {
      add_nodes: [{ id: "c", label: "C", description: "new", kind: "visual" }],
      update_nodes: [{ id: "a", description: "slider 0-10" }],
      remove_node_ids: ["b"],
      add_edges: [{ source: "a", target: "c", label: "drives" }],
      remove_edges: [],
    },
    "make it bigger",
  );
  assert.deepEqual(out.nodes.map((n) => n.id), ["a", "c"]);
  assert.equal(out.nodes[0].description, "slider 0-10");
  assert.equal(out.nodes[0].change_note, "make it bigger");
  assert.deepEqual(out.edges, [{ source: "a", target: "c", label: "drives" }]);
});

test("extract helpers", () => {
  assert.deepEqual(extractJson('here:\n```json\n{"a":[1]}\n```'), { a: [1] });
  assert.match(extractHtml("```html\n<!doctype html><html><body>x</body></html>\n```"), /^<!doctype/);
  assert.throws(() => extractHtml("<div>no</div>"));
  assert.throws(() => extractSvg("<svg><script>x</script></svg>"));
});

const SIM = `<!doctype html><html><body>
<input id="m" type="range" min="0" max="10" value="1"><span id="out">1</span><button id="go">go</button>
<script>document.getElementById('m').addEventListener('input',e=>document.getElementById('out').textContent=e.target.value*2);
document.getElementById('go').addEventListener('click',()=>{undefinedFn()});</script></body></html>`;

test("tool_2 collects javascript errors", async () => {
  const errs = await loadAndCollectErrors(SIM);
  assert.ok(errs.some((e) => e.includes("undefinedFn")), errs.join("\n"));
});

test("tool_2 runs test cases with screenshots", async () => {
  const { results, screenshots } = await runTests(SIM, [
    { id: "t1", title: "t", purpose: "", expected: "", steps: [{ action: "set_value", selector: "#m", value: "4" }, { action: "read_text", selector: "#out" }, { action: "click", selector: "#missing" }] },
  ]);
  assert.equal(results[0].read_values[0], "#out = 8");
  assert.equal(results[0].step_errors.length, 1);
  assert.match(screenshots[0], /^data:image\/png;base64,/);
});
