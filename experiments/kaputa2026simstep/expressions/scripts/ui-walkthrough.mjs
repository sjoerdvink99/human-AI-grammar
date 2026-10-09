// Browser walk-through of the workspace using artifacts saved by scripts/e2e.ts.
// Usage: node scripts/ui-walkthrough.mjs <e2eOutDir> <screenshotDir>   (dev server must run on :5317)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [dir, shots] = process.argv.slice(2);
const j = (f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
const html = (f) => readFileSync(`${dir}/${f}`, "utf8");
const run = j("p3_run-tests.json");
const project = {
  learning_content: "Buoyancy …",
  concept_graph: [j("p1_concept-graph.json")],
  scenarios: j("p1_scenarios.json"),
  scenario: j("p1_scenarios.json")[0],
  scenario_graph: j("p1_scenario-graph.json"),
  learning_goals: j("p1_learning-goals.json"),
  learning_goal: j("p1_learning-goals.json")[0],
  learning_goal_graph: j("p1_learning-goal-graph.json"),
  experiment_factors: j("p1_experiment-factors.json"),
  procedure: j("p1_procedure.json"),
  ui_graph: [j("p1_ui-graph.json")],
  simulation_code: [
    { id: "simulation_code_1", html: j("p1_simulation-code.json"), createdAt: 1, note: "generated" },
    { id: "simulation_code_2", html: j("p3_fix-errors.json"), createdAt: 2, note: "fixed" },
    { id: "simulation_code_3", html: html("simulation_code_3.html"), createdAt: 3, note: "repaired" },
  ],
  current_code_id: "simulation_code_3",
  javascript_errors: j("p3_javascript-errors.json"),
  test_cases: j("p3_test-cases.json"),
  test_results: run.results,
  test_screenshots: run.screenshots,
  test_assessment: j("p3_evaluate.json"),
  verified: true,
};

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://localhost:5317/");
await page.evaluate((p) => localStorage.setItem("systemx.project.v1", JSON.stringify(p)), project);
await page.goto("http://localhost:5317/");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/workspace.png` });

// Process 4: select first test, run live in iframe
await page.locator(".list-item").first().click();
await page.click("text=Run in simulation");
await page.waitForSelector(".log li", { timeout: 60000 });
console.log("live test log:", await page.$$eval(".log li", (l) => l.map((x) => x.textContent)));
await page.screenshot({ path: `${shots}/p4-run.png` });

// Process 8: region → match (real model call)
await page.click(".tabs >> text=Find in graph");
const box = await page.locator(".sim-frame").boundingBox();
await page.mouse.move(box.x + 40, box.y + 80);
await page.mouse.down();
await page.mouse.move(box.x + 500, box.y + 450, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(500);
console.log("region summary:", await page.locator(".panel .small").first().textContent());
await page.waitForSelector("text=Matching UI-graph nodes", { timeout: 180000 });
await page.screenshot({ path: `${shots}/p8-find.png` });

// Process 7: region + sketch canvas opens
await page.click(".tabs >> text=Redraw");
await page.mouse.move(box.x + 100, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/p7-region.png` });
console.log("redraw panel:", await page.locator(".panel").innerText());
await page.click('button:has-text("Sketch a replacement")');
await page.waitForTimeout(300);
console.log("sketch nodes:", await page.locator(".sketch").count());
const c = await page.locator(".sketch canvas").boundingBox();
await page.mouse.move(c.x + 30, c.y + 30);
await page.mouse.down();
await page.mouse.move(c.x + 200, c.y + 150, { steps: 10 });
await page.mouse.up();
await page.screenshot({ path: `${shots}/p7-sketch.png` });
await page.click('button:has-text("Use sketch")');
await page.waitForSelector("text=Code versions", { timeout: 1000 });
await page.waitForFunction(() => document.querySelectorAll(".versions button").length >= 4, null, { timeout: 600000 });
await page.screenshot({ path: `${shots}/p7-redrawn.png` });
console.log("versions:", await page.$$eval(".versions button", (b) => b.map((x) => x.textContent)));
console.log("page errors:", errs);
await b.close();
