// End-to-end smoke walk through the model operations against a running server (npm run server).
// DOM-only steps (silhouette extraction) are replaced by the full canvas box here.
import { readFileSync } from "node:fs";
import { boxesToParts, initialParts, normalizeReference, checkBoxes, imageToPart, placementsToParts } from "../src/shared/tools1";
import { composeAssembly } from "../src/shared/tools2";
import { applyOps, runFabChecks } from "../src/shared/tools3";
import { DEFAULT_CONSTRAINTS } from "../src/web/store";

const BASE = process.env.API ?? "http://localhost:8787";
async function model<T>(op: string, input: unknown): Promise<T> {
  const t = Date.now();
  const r = await fetch(`${BASE}/api/model/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const b = await r.json();
  if (!r.ok) throw new Error(`${op}: ${b.error}`);
  console.log(`✓ ${op} (${Date.now() - t} ms)`);
  return b as T;
}

const prompt = process.argv[2] ?? "a small bedside table with one drawer and four straight legs";
const svg: string = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")).svg : (await model<{ svg: string }>("generateImage", { prompt, variant: 0, kind: "concept" })).svg;
const edited = (await model<{ svg: string }>("editImage", { svg, instruction: "make the drawer handle round" })).svg;
const spec = await model<any>("generateSpec", { svg: edited });
console.log("  spec:", spec.name, spec.dimensions, spec.parts.map((p: any) => `${p.name}×${p.count}`).join(", "));
const spec2 = await model<any>("reviseSpec", { svg: edited, spec, feedback: "make it 500 mm tall" });
console.log("  revised dims:", spec2.dimensions);
const selection = { objectName: spec2.name, dimensions: spec2.dimensions, parts: spec2.parts };
const { parts } = await model<any>("extractParts", { svg: edited, selection });
console.log("  pieces:", parts.map((p: any) => p.id).join(", "));
const { notes } = await model<any>("extractAssemblyNotes", { svg: edited, parts });
const ref = normalizeReference(edited);
const p3d = initialParts(parts);
const { queries } = await model<any>("groundingQueries", { svg: ref, parts, notes, parts3d: p3d });
const { boxes } = await model<any>("ground", { svg: ref, queries });
console.log("  boxes:", boxes.map((b: any) => `${b.partId}@${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`).join(" | "));
const p3d2 = boxesToParts(p3d, parts, boxes, selection.dimensions);
const critique = await model<any>("critiqueParts", { svg: ref, parts, notes, parts3d: p3d2 });
console.log("  critique:", critique);
const checks = checkBoxes(boxes, parts);
console.log("  box checks failing:", checks.filter((c) => !c.pass).map((c) => `${c.partId}: ${c.issues.join(";")}`));
const { boxes: b16 } = await model<any>("reground", { svg: ref, queries, boxes, checks });
const side = await model<any>("sideView", { svg: ref, query: queries[0].query, check: checkBoxes(b16, parts)[0] });
console.log("  side view chars:", side.svg.length);
const judge = await model<any>("judgePartImage", { svg: side.svg });
console.log("  judge:", judge);
const clean = await model<any>("cleanPartImage", { svg: side.svg, verdict: judge.verdict });
imageToPart(clean.svg, { partId: "", x: 0, y: 0, w: 512, h: 512, confidence: 1 }, { name: "x", height: 300, depth: 6, material: "oak" });
const asm = composeAssembly(p3d2);
const regen = await model<any>("regeneratePart", { svg: ref, partName: asm.parts[0].name });
console.log("  regenerated chars:", regen.svg.length);
const { planned } = await model<any>("planPartEdit", { assembly: asm, partId: asm.parts[0].id, instruction: "add a lower shelf between the legs" });
const { placements } = await model<any>("place3d", { planned });
console.log("  new parts:", placementsToParts(planned, placements).map((p) => `${p.name} ${JSON.stringify(p.position)} ${JSON.stringify(p.size)}`));
const fab = runFabChecks(asm, DEFAULT_CONSTRAINTS);
console.log("  fab checks:", fab.map((c) => `${c.severity}:${c.kind}`).join(", "));
const advice = await model<any>("adviseFab", { assembly: asm, constraints: DEFAULT_CONSTRAINTS, checks: fab });
console.log("  advice:", advice.summary.slice(0, 160), advice.suggestions.map((s: any) => s.title));
if (advice.suggestions[0]) {
  const { ops } = await model<any>("suggestionToOps", { assembly: asm, constraints: DEFAULT_CONSTRAINTS, suggestion: advice.suggestions[0] });
  const res = applyOps(asm, ops);
  console.log("  ops:", ops.length, "skipped:", res.skipped, "→ checks:", runFabChecks(res.assembly, DEFAULT_CONSTRAINTS).map((c) => `${c.severity}:${c.kind}`).join(", "));
}
