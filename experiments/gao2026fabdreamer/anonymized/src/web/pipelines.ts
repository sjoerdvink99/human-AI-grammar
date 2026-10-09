// Process orchestration: one exported function per transformation (or per automatic chain of them),
// named after the design's processes (P1 … P11). Human steps are UI events that call these.
import { model, pool } from "./api";
import { useApp, track, setBusyLabel, currentConcept, currentSpec, currentAssembly, commitAssembly, type RefineRound } from "./store";
import type {
  Advice, Box2D, BoxCheck, Critique, EditOp, GroundingQuery, Part3D, PartImageVerdict, PartRecord, PartSelection,
  Placement3D, PlannedPart, Spec, Svg, ExportFormat,
} from "../shared/types";
import {
  boxesToParts, checkBoxes, composeExport, cropSvg, imageToPart, initialParts, normalizeReference, placementsToParts,
  refinePartsFromViews, toDrawingSvg, toOpenScad, uid, CANVAS,
} from "../shared/tools1";
import { composeAssembly } from "../shared/tools2";
import { applyOps, runFabChecks } from "../shared/tools3";
import { svgSilhouetteBox } from "./svgdom";

const S = () => useApp.getState();
const svgOf = (r: { svg: Svg }) => r.svg;

// ---------------- P1: r1 → [model_2 generate]~ → r2* → [human select] → r3 ----------------
export const p1Generate = () => track("p1", "model_2 is drawing 3 concepts…", async () => {
  const prompt = S().conceptPrompt.trim();
  if (!prompt) throw new Error("Write a prompt first.");
  S().set({ conceptCandidates: [] });
  const out = await pool([0, 1, 2], 3, async (variant) => {
    const r = await model<{ svg: Svg }>("generateImage", { prompt, variant, kind: "concept" }).catch(() => null);
    if (r) S().set((s) => ({ conceptCandidates: [...s.conceptCandidates, r.svg] }));
    return r;
  });
  if (!out.some(Boolean)) throw new Error("No concept image could be generated.");
});

export function p1Select(svg: Svg) {
  S().set({ concept: [{ id: uid("r3"), svg, note: "selected concept", createdAt: Date.now() }], conceptIndex: 0, tab: "concept" });
}

// ---------------- P2: r3 → [human specify] r4 → [model_2 modify]~ → r3_2 ----------------
export const p2Edit = (instruction: string) => track("p2", "model_2 is editing the concept…", async () => {
  const cur = currentConcept(S());
  if (!cur) throw new Error("Select a concept first.");
  const r = await model<{ svg: Svg }>("editImage", { svg: cur.svg, instruction });
  S().set((s) => {
    const versions = [...s.concept.slice(0, s.conceptIndex + 1), { id: uid("r3"), svg: r.svg, note: instruction, createdAt: Date.now() }];
    return { concept: versions, conceptIndex: versions.length - 1 };
  });
});

// ---------------- P3: r3 → [model_1 generate]~ → r5; r6 → [model_1 modify]~ → r5 (loop) ----------------
export const p3GenerateSpec = () => track("p3", "model_1 is writing the spec…", async () => {
  const cur = currentConcept(S());
  if (!cur) throw new Error("Select a concept first.");
  const spec = await model<Spec>("generateSpec", { svg: cur.svg });
  S().set({ spec: [spec], specIndex: 0 });
});

export const p3ReviseSpec = (feedback: string) => track("p3", "model_1 is revising the spec…", async () => {
  const s = S(); const cur = currentConcept(s); const spec = currentSpec(s);
  if (!cur || !spec) throw new Error("Generate a spec first.");
  const next = await model<Spec>("reviseSpec", { svg: cur.svg, spec, feedback });
  S().set((st) => { const v = [...st.spec.slice(0, st.specIndex + 1), next]; return { spec: v, specIndex: v.length - 1 }; });
});

// ---------------- P4: r3 + r5 → [human select] r7 → … → loop ----------------
const MAX_AUTO_ROUNDS = 2;

export const p4Build = (selection: PartSelection) => track("p4", "model_1 is extracting parts…", async () => {
  const concept = currentConcept(S());
  if (!concept) throw new Error("Select a concept first.");
  S().set({ partSelection: selection, refineRounds: [], boxChecks: [], regroundings: [], boxChecks2: [], sideViews: [], sideBoxes: [], refinedParts: [] });
  // [model_1 extract] r3 + r7 → r8*
  const { parts } = await model<{ parts: PartRecord[] }>("extractParts", { svg: concept.svg, selection });
  S().set({ parts });
  // [model_1 extract] r3 + r8* → r9
  setBusyLabel("p4", "model_1 is writing assembly notes…");
  const { notes } = await model<{ notes: string }>("extractAssemblyNotes", { svg: concept.svg, parts });
  // [tool_1 modify] r3 → r10 + r11*
  const reference = normalizeReference(concept.svg);
  S().set({ assemblyNotes: notes, reference, parts3d: initialParts(parts) });
  await p4Round(1);
});

/** One round of the P4 loop, from the state (r10, r8*, r9, r11_1*). */
async function p4Round(round: number): Promise<void> {
  const { reference, parts, assemblyNotes, parts3d, partSelection } = S();
  if (!reference || !partSelection) return;
  // [model_1 extract] → r12*
  setBusyLabel("p4", `round ${round}: model_1 is writing grounding queries…`);
  const { queries } = await model<{ queries: GroundingQuery[] }>("groundingQueries", { svg: reference, parts, notes: assemblyNotes, parts3d });
  S().set({ groundingQueries: queries });
  // [model_3 extract] → r13*
  setBusyLabel("p4", `round ${round}: model_3 is grounding ${queries.length} parts…`);
  const { boxes } = await model<{ boxes: Box2D[] }>("ground", { svg: reference, queries });
  // [tool_1 translate] → r11_2*
  const parts3d2 = boxesToParts(parts3d, parts, boxes, partSelection.dimensions);
  S().set({ groundings: boxes, parts3d: parts3d2 });
  // [model_1 generate]~ → r14
  setBusyLabel("p4", `round ${round}: model_1 is critiquing the parts…`);
  const critique = await model<Critique>("critiqueParts", { svg: reference, parts, notes: assemblyNotes, parts3d: parts3d2 });
  const record: RefineRound = { round, referenceSvg: reference, queries, boxes, parts3d: parts3d2, critique };
  S().set((s) => ({ refineRounds: [...s.refineRounds, record] }));
  // loop check in code: stop when model_1 is satisfied or after MAX_AUTO_ROUNDS
  if (critique.ok || !critique.instruction.trim() || round >= MAX_AUTO_ROUNDS) return;
  await p4ApplyCritique(critique.instruction, round);
}

/** [model_2 modify]~ r10 + r14 → back to (r10, r8*, r9, r11_1*), then the next round. */
async function p4ApplyCritique(instruction: string, round: number) {
  const { reference, parts } = S();
  if (!reference) return;
  setBusyLabel("p4", `round ${round}: model_2 is editing the reference image…`);
  const { svg } = await model<{ svg: Svg }>("editImage", { svg: reference, instruction });
  S().set({ reference: normalizeReference(svg), parts3d: initialParts(parts) });
  await p4Round(round + 1);
}

export const p4AnotherRound = () => track("p4", "Running another round…", async () => {
  const last = S().refineRounds.at(-1);
  if (last?.critique?.instruction) await p4ApplyCritique(last.critique.instruction, last.round);
  else await p4Round((last?.round ?? 0) + 1);
});

export function p4RestoreRound(round: RefineRound) {
  S().set({ reference: round.referenceSvg, groundingQueries: round.queries, groundings: round.boxes, parts3d: round.parts3d });
}

// ---------------- P5: r10 + r12* + r13* → tool/model_3/model_2 → r19* ----------------
export const p5Refine = () => track("p5", "tool_1 is checking the boxes…", async () => {
  const { reference, groundingQueries, groundings, parts, parts3d, partSelection } = S();
  if (!reference || !partSelection) throw new Error("Build parts first (step 3).");
  // [tool_1 evaluate] → r15_1*
  const checks1 = checkBoxes(groundings, parts);
  S().set({ boxChecks: checks1 });
  // [model_3 modify] → r16*
  let boxes16 = groundings;
  if (checks1.some((c) => !c.pass)) {
    setBusyLabel("p5", "model_3 is fixing failing boxes…");
    boxes16 = (await model<{ boxes: Box2D[] }>("reground", { svg: reference, queries: groundingQueries, boxes: groundings, checks: checks1 })).boxes;
  }
  // [tool_1 evaluate] → r15_2*
  const checks2 = checkBoxes(boxes16, parts);
  S().set({ regroundings: boxes16, boxChecks2: checks2 });
  // [model_2 generate]~ → r17*  (one side view per grounded part)
  const targets = groundingQueries.filter((q) => boxes16.some((b) => b.partId === q.partId));
  let done = 0;
  setBusyLabel("p5", `model_2 is drawing side views (0/${targets.length})…`);
  const views = await pool(targets, 4, async (q) => {
    const r = await model<{ svg: Svg }>("sideView", { svg: reference, query: q.query, check: checks2.find((c) => c.partId === q.partId) }).catch(() => null);
    setBusyLabel("p5", `model_2 is drawing side views (${++done}/${targets.length})…`);
    return r ? { partId: q.partId, svg: svgOf(r) } : null;
  });
  const sideViews = views.filter((v): v is { partId: string; svg: Svg } => !!v);
  // [tool_1 extract] → r18*
  const sideBoxes = sideViews.map((v) => svgSilhouetteBox(v.svg, v.partId)).filter((b): b is Box2D => !!b);
  // [tool_1 translate] → r19*
  const refinedParts = refinePartsFromViews(parts3d, parts, boxes16, partSelection.dimensions, sideViews, sideBoxes);
  S().set({ sideViews, sideBoxes, refinedParts });
});

// ---------------- P6: r20 → images → select → evaluate → clean → bbox → 3D part ----------------
export const p6Generate = () => track("p6", "model_2 is drawing part options…", async () => {
  const prompt = S().studio.prompt.trim();
  if (!prompt) throw new Error("Describe the part first.");
  S().set((s) => ({ studio: { ...s.studio, candidates: [], chosen: null, verdict: null, reason: "", clean: null, box: null, part: null } }));
  await pool([0, 1, 2], 3, async (variant) => {
    const r = await model<{ svg: Svg }>("generateImage", { prompt, variant, kind: "part" }).catch(() => null);
    if (r) S().set((s) => ({ studio: { ...s.studio, candidates: [...s.studio.candidates, r.svg] } }));
  });
  if (!S().studio.candidates.length) throw new Error("No part image could be generated.");
});

/** [human select] r21* → r22, then the automatic chain r23 → r24 → r25 → r26. */
export const p6Select = (svg: Svg) => track("p6", "model_1 is judging the image…", async () => {
  S().set((s) => ({ studio: { ...s.studio, chosen: svg, verdict: null, reason: "", clean: null, box: null, part: null } }));
  // [model_1 evaluate] → r23
  const { verdict, reason } = await model<{ verdict: PartImageVerdict; reason: string }>("judgePartImage", { svg });
  S().set((s) => ({ studio: { ...s.studio, verdict, reason } }));
  // [model_2 generate]~ → r24
  setBusyLabel("p6", "model_2 is drawing a clean silhouette…");
  const { svg: clean } = await model<{ svg: Svg }>("cleanPartImage", { svg, verdict });
  // [tool_1 extract] → r25
  const box = svgSilhouetteBox(clean, "studio");
  if (!box) throw new Error("No silhouette found in the clean image.");
  // [tool_1 translate] → r26
  const st = S().studio;
  const part = imageToPart(clean, box, { name: st.prompt.slice(0, 40), height: st.height, depth: st.depth, material: st.material });
  S().set((s) => ({ studio: { ...s.studio, clean, box, part } }));
});

// ---------------- P7: r11* → [tool_2 compose] → r27 → render → [human modify] → r27_2 → render ----------------
export function p7Compose(source: "r11" | "r19") {
  const s = S();
  const parts = source === "r19" && s.refinedParts.length ? s.refinedParts : s.parts3d;
  if (!parts.length) return;
  S().set({ assemblyHistory: [], assemblyIndex: -1 });
  commitAssembly(composeAssembly(parts));
  S().set({ tab: "assembly", selectedPartId: null });
}

/** Human modify on r27: add or replace a part produced elsewhere (r19, r26, r32, r37). */
export function p7AddOrReplace(part: Part3D, replacesId: string | null) {
  const a = currentAssembly(S()) ?? { parts: [] };
  const clean: Part3D = { ...part, id: replacesId ?? (a.parts.some((p) => p.id === part.id) ? uid("part") : part.id) };
  const parts = replacesId ? a.parts.map((p) => (p.id === replacesId ? clean : p)) : [...a.parts, clean];
  commitAssembly({ parts });
}

// ---------------- P8: r3 + r27 → select r29 → crop r30 → model_2 modify r31 → r32 ----------------
export const p8Regenerate = (partId: string) => track("p8", "tool_1 is cropping the concept…", async () => {
  const s = S(); const concept = currentConcept(s); const asm = currentAssembly(s);
  const part = asm?.parts.find((p) => p.id === partId);
  if (!concept || !part) throw new Error("Need a concept image and a part.");
  // [tool_1 extract] → r30
  const ref = normalizeReference(concept.svg);
  const crop = part.imageBox ? cropSvg(ref, part.imageBox, 0.15) : ref;
  S().set({ regen: { partId, crop, image: null, part: null } });
  // [model_2 modify]~ → r31
  setBusyLabel("p8", "model_2 is redrawing the part…");
  const { svg: image } = await model<{ svg: Svg }>("regeneratePart", { svg: crop, partName: part.name });
  // [tool_1 translate] → r32
  const box = svgSilhouetteBox(image, partId) ?? { partId, x: 0, y: 0, w: CANVAS, h: CANVAS, confidence: 0 };
  const r32 = imageToPart(image, box, {
    id: part.id, name: part.name, height: part.size.h, width: part.size.w, depth: part.size.d, material: part.material, position: part.position, rotationY: part.rotationY,
  });
  S().set({ regen: { partId, crop, image, part: r32 } });
});

// ---------------- P9: r27 → select r33 → specify r34 → r35* → r36* → r37* ----------------
export const p9LanguageEdit = (partId: string, instruction: string) => track("p9", "model_1 is planning the change…", async () => {
  const asm = currentAssembly(S());
  if (!asm) throw new Error("Compose an assembly first.");
  S().set({ langEdit: { partId, instruction, planned: [], placements: [], parts: [] } });
  const { planned } = await model<{ planned: PlannedPart[] }>("planPartEdit", { assembly: asm, partId, instruction });
  S().set((s) => ({ langEdit: { ...s.langEdit, planned } }));
  setBusyLabel("p9", "model_3 is placing the parts in 3D…");
  const { placements } = await model<{ placements: Placement3D[] }>("place3d", { planned });
  const parts = placementsToParts(planned, placements);
  S().set((s) => ({ langEdit: { ...s.langEdit, placements, parts } }));
});

// ---------------- P10: r27 + r38 → checks → advice → select → ops → execute → (loop) ----------------
export const p10Check = () => track("p10", "tool_3 is checking the design…", async () => {
  const s = S(); const asm = currentAssembly(s);
  if (!asm) throw new Error("Compose an assembly first.");
  // [tool_3 evaluate] → r39*
  const checks = runFabChecks(asm, s.constraints);
  S().set((st) => ({ fabRounds: [...st.fabRounds, { checks, advice: null, chosen: null, ops: [], skipped: [] }] }));
  // [model_4 generate]~ → r40
  setBusyLabel("p10", "model_4 is explaining the results…");
  const advice = await model<Advice>("adviseFab", { assembly: asm, constraints: s.constraints, checks });
  S().set((st) => ({ fabRounds: st.fabRounds.map((r, i) => (i === st.fabRounds.length - 1 ? { ...r, advice } : r)) }));
});

/** [human select] r41 → [model_4 translate] r42 → [tool_3 execute] r27 → loop back (re-check). */
export const p10Apply = (suggestion: Advice["suggestions"][number]) => track("p10", "model_4 is turning the fix into edits…", async () => {
  const s = S(); const asm = currentAssembly(s);
  if (!asm) return;
  const { ops } = await model<{ ops: EditOp[] }>("suggestionToOps", { assembly: asm, constraints: s.constraints, suggestion });
  const { assembly, skipped } = applyOps(asm, ops);
  S().set((st) => ({ fabRounds: st.fabRounds.map((r, i) => (i === st.fabRounds.length - 1 ? { ...r, chosen: suggestion, ops, skipped } : r)) }));
  commitAssembly(assembly);
}).then(() => p10Check());

// ---------------- P11: r27 + r38 → [tool_1 translate] r43* + r44* → [human select] r45 → [tool_1 compose] r46 ----------------
export function p11Translate() {
  const s = S(); const asm = currentAssembly(s);
  if (!asm) return null;
  const name = currentSpec(s)?.name ?? "design";
  const scad = toOpenScad(asm, name);
  const drawings = asm.parts.map((p) => ({ name: `drawings/${p.id}.svg`, content: toDrawingSvg(p, s.constraints) }));
  return { name, scad, drawings };
}

export function p11Compose(format: ExportFormat) {
  const t = p11Translate();
  const s = S(); const asm = currentAssembly(s);
  if (!t || !asm) return null;
  return composeExport(format, t.name, asm, s.constraints, t.scad, t.drawings);
}

export type { BoxCheck };
