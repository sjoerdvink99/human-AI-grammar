// End-to-end walk through every process against a running server (real model calls).
// Usage: npx tsx scripts/e2e.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Graph, Region, TestCase } from "../shared/types";

const BASE = process.env.BASE ?? "http://localhost:8931";
const OUT = process.argv[2] ?? "/tmp/systemx-e2e";
mkdirSync(OUT, { recursive: true });

async function call<T>(p: string, body: unknown): Promise<T> {
  const t = Date.now();
  const r = await fetch(`${BASE}/api/${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = (await r.json()) as { result: T; error?: string };
  if (d.error) throw new Error(`${p}: ${d.error}`);
  console.log(`✓ ${p} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  writeFileSync(`${OUT}/${p.replace("/", "_")}.json`, JSON.stringify(d.result, null, 2));
  return d.result;
}

/** Stand-in for tool_1's region element lookup: region around the first element tagged with a ui node of `kind`. */
async function regionFor(html: string, pick: (ids: string[]) => string): Promise<Region> {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 900, height: 640 } });
  await page.setContent(html);
  const nodes = await page.$$eval("[data-ui-node]", (els) => els.map((e) => e.getAttribute("data-ui-node")!));
  const id = pick(nodes);
  const box = (await page.locator(`[data-ui-node="${id}"]`).first().boundingBox())!;
  await b.close();
  const r = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(Math.min(box.width, 400)), h: Math.round(Math.min(box.height, 300)) };
  return { ...r, elements: [{ tag: "div", id: "", ui_node: id, classes: "", text: "", rect: r }] };
}

async function sketchPng(w: number, h: number): Promise<string> {
  const b = await chromium.launch();
  const page = await b.newPage();
  const url = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d")!;
      x.fillStyle = "#fff";
      x.fillRect(0, 0, w, h);
      x.lineWidth = 3;
      x.strokeStyle = "#2563eb";
      x.strokeRect(w * 0.2, h * 0.3, w * 0.6, h * 0.5); // a tank
      x.strokeStyle = "#111";
      x.beginPath();
      x.arc(w / 2, h * 0.5, Math.min(w, h) * 0.1, 0, Math.PI * 2); // a ball
      x.stroke();
      return c.toDataURL("image/png");
    },
    [w, h],
  );
  await b.close();
  return url;
}

const learning_content = `Buoyancy. When an object is placed in a fluid, the fluid exerts an upward force called the buoyant force. Archimedes' principle: the buoyant force equals the weight of the displaced fluid. Objects denser than the fluid sink; less dense objects float. Density is mass divided by volume. Salt water is denser than fresh water.`;

// Process 1
const concept_graph = await call<Graph>("p1/concept-graph", { learning_content });
// Process 2 (human modify, simulated): add a concept
const concept_graph_2: Graph = { ...concept_graph, nodes: [...concept_graph.nodes, { id: "ship_hull", label: "Ship hull", description: "added by teacher", kind: "concept" }] };
const scenarios = await call<string[]>("p1/scenarios", { concept_graph: concept_graph_2 });
const scenario = scenarios[0];
const scenario_graph = await call<Graph>("p1/scenario-graph", { concept_graph: concept_graph_2, scenario });
const learning_goals = await call<string[]>("p1/learning-goals", { scenario_graph });
const learning_goal = learning_goals[0];
const learning_goal_graph = await call<Graph>("p1/learning-goal-graph", { scenario_graph, learning_goal });
const experiment_factors = await call("p1/experiment-factors", { learning_goal_graph, learning_goal });
const procedure = await call<string>("p1/procedure", { learning_goal_graph, learning_goal, experiment_factors });
const ui_graph = await call<Graph>("p1/ui-graph", { learning_goal_graph, learning_goal, procedure });
const code1 = await call<string>("p1/simulation-code", { ui_graph, learning_goal });

// Process 3
const javascript_errors = await call<string[]>("p3/javascript-errors", { simulation_code: code1 });
const code2 = await call<string>("p3/fix-errors", { simulation_code: code1, ui_graph, learning_goal, javascript_errors });
const test_cases = await call<TestCase[]>("p3/test-cases", { simulation_code: code2, ui_graph, learning_goal });
const run = await call<{ results: unknown[]; screenshots: string[] }>("p3/run-tests", { simulation_code: code2, test_cases });
const test_assessment = await call<string>("p3/evaluate", { simulation_code: code2, ui_graph, learning_goal, test_cases, test_results: run.results, test_screenshots: run.screenshots });
const code3 = await call<string>("p3/repair", { simulation_code: code2, ui_graph, test_cases, test_assessment });
writeFileSync(`${OUT}/simulation_code_3.html`, code3);

// Process 4 (human verdict simulated as "partially_works")
const about = `${test_cases[0].title} — expected: ${test_cases[0].expected}`;
const repair_target = await call<string>("p4/repair-target", { simulation_code: code3, ui_test_feedback: "partially_works", about });
const suggested_repair = await call<{ changes: string[] }>("p4/suggest", { simulation_code: code3, repair_target, ui_test_feedback: "partially_works", about });
const guided = await call<string>("p4/apply", { simulation_code: code3, approved_repair: { ...suggested_repair, changes: suggested_repair.changes.slice(0, 1) } });
writeFileSync(`${OUT}/simulation_code_guided_4.html`, guided);

// Process 5
const chat_region = await regionFor(code3, (ids) => ids.find((i) => /visual|canvas|tank|scene/i.test(i)) ?? ids[0]);
const issue = "Make the water a lighter blue and label the water level.";
const target2 = await call<string>("p5/repair-target", { simulation_code: code3, ui_graph, issue, chat_region });
const suggested_change = await call("p5/suggest", { simulation_code: code3, ui_graph, repair_target: target2, issue, chat_region });
const { applyGraphChanges } = await import("../src/lib/graphDiff");
const ui_graph_2 = applyGraphChanges(ui_graph, (suggested_change as any).ui_graph_changes ?? { add_nodes: [], update_nodes: [], remove_node_ids: [], add_edges: [], remove_edges: [] }, issue);
writeFileSync(`${OUT}/ui_graph_2.json`, JSON.stringify(ui_graph_2, null, 2));
const chat4 = await call<string>("p5/regenerate", { simulation_code: code3, ui_graph: ui_graph_2 });
writeFileSync(`${OUT}/simulation_code_chat_4.html`, chat4);

// Process 6
const selected_node = ui_graph.nodes.find((n) => n.kind === "logic")?.id ?? ui_graph.nodes[0].id;
const assumptions = await call<{ node_id: string; items: { name: string; value: string }[] }>("p6/assumptions", { simulation_code: code3, ui_graph, selected_node });
assumptions.items[0] = { ...assumptions.items[0], value: assumptions.items[0].value + " (teacher: doubled)" };
const ass4 = await call<string>("p6/apply", { simulation_code: code3, assumptions });
writeFileSync(`${OUT}/simulation_code_assumptions_4.html`, ass4);

// Process 7
const redraw_region = await regionFor(code3, (ids) => ids.find((i) => /visual|canvas|tank|scene/i.test(i)) ?? ids[0]);
const sketch = await sketchPng(redraw_region.w, redraw_region.h);
const replacement_svg = await call<string>("p7/svg", { sketch, redraw_region });
const redrawn = await call<string>("p7/integrate", { simulation_code: code3, replacement_svg, redraw_region });
writeFileSync(`${OUT}/simulation_code_redrawn_4.html`, redrawn);

// Process 8
const subgraph = await call<string[]>("p8/match", { ui_graph, subgraph_region: chat_region, simulation_code: code3 });
console.log("subgraph:", subgraph);
console.log("ALL PROCESSES OK →", OUT);
