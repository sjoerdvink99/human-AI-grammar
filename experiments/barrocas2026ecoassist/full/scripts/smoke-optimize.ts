// End-to-end check of process 3 against a running server: POST /api/optimize with the example page.
import { EXAMPLE } from "../web/src/examples.ts";
import { applySelected } from "../shared/diff.ts";
const port = process.env.PORT ?? "3001";
const r = await fetch(`http://localhost:${port}/api/optimize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: EXAMPLE }) });
const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
for (const l of lines) if (l.stage !== "result") console.log(l.stage, l.message ?? l.error ?? l.energyBefore?.joules);
const res = lines.find((l) => l.stage === "result")?.result;
if (res) {
  console.log("before J", res.energyBefore.joules.toFixed(2), "after J", res.energyAfter.joules.toFixed(2), "savings %", res.savings.percent.toFixed(1));
  console.log("hunks", res.diff.hunks.length, "changes:", res.explanation);
  const half = res.diff.hunks.filter((_: unknown, i: number) => i % 2 === 0).map((h: { id: string }) => h.id);
  const code3 = applySelected(res.code1, res.code2, half);
  console.log("applied", half.length, "hunks → code_3 js length", code3.js.length);
}
