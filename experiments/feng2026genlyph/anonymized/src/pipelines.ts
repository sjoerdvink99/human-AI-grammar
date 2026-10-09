/**
 * The automatic chains of the design. Each function runs the transformations of one
 * process (or the part of it with no human step) in the design's order.
 */
import { api } from "./api.ts";
import { uid, type AppState, type Update } from "./store.ts";
import type { BaseChart, Crop, Dataset, Illustration, Segment, SegmentLabel, Variant } from "./types.ts";
import { profileData, describeProfile } from "./tools/profile.ts";
import { parseConcepts } from "./tools/concepts.ts";
import { baseChartSvg } from "./tools/basechart.ts";
import { composeIllustrationPrompts, composeSteeredPrompt, composeVariantPrompts } from "./tools/compose.ts";
import { tagElements } from "./tools/svg.ts";
import { cropSegments } from "./tools/crop.ts";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** model_2 generate~ for one prompt, writing into round `roundId`, item `id`. */
async function illustrateInto(update: Update, roundId: string, id: string, prompt: string) {
  const patch = (p: Partial<Illustration>) =>
    update((s) => ({
      ...s,
      r8Rounds: s.r8Rounds.map((r) =>
        r.id !== roundId ? r : { ...r, items: r.items.map((it) => (it.id === id ? { ...it, ...p } : it)) },
      ),
    }));
  try {
    const { svg } = await api.illustrate(prompt);
    patch({ status: "done", svg: tagElements(svg), error: undefined });
  } catch (e) {
    patch({ status: "error", error: errMsg(e) });
  }
}

function startRound(update: Update, prompts: string[], steer?: string): Promise<void> {
  const roundId = uid("r");
  const items: Illustration[] = prompts.map((prompt) => ({ id: uid("i"), prompt, status: "pending" }));
  update((s) => {
    const version = (s.r8Rounds.at(-1)?.version ?? 0) + 1;
    return { ...s, r8Rounds: [...s.r8Rounds, { id: roundId, version, steer, items }] };
  });
  return Promise.all(items.map((it) => illustrateInto(update, roundId, it.id, it.prompt))).then(() => undefined);
}

/** Process 1: r1 -> r2 -> r3 -> r4 -> r5* (+ r6) -> r7* -> r8_1* */
export async function runProcess1(r1: Dataset, update: Update, count = 4) {
  const r2 = profileData(r1); // tool_1 extract
  const r3 = describeProfile(r2, r1.name); // tool_1 translate
  update((s) => ({ ...s, r2, r3, r4: undefined, r4Status: "pending", r4Error: undefined, r5: [], r7: [] }));
  let r4: string;
  try {
    r4 = (await api.themes(r3)).r4; // model_1 generate~
  } catch (e) {
    update((s) => ({ ...s, r4Status: "error", r4Error: errMsg(e) }));
    return;
  }
  const r5 = parseConcepts(r4); // tool_1 extract
  if (r5.length === 0) {
    update((s) => ({ ...s, r4, r4Status: "error", r4Error: "No concepts could be read from the model reply. Try again." }));
    return;
  }
  const r6 = baseChartSvg(r1, r2); // tool_1 translate
  const r7 = composeIllustrationPrompts(r5, r6, count); // tool_1 compose
  update((s) => ({ ...s, r4, r4Status: "done", r5, r6, r7 }));
  await startRound(update, r7); // model_2 generate~
}

/** Process 2: r9 -> r10 -> r8_2* (loops back to r9 through the UI) */
export async function runProcess2(r9: string, r5: string[], r6: BaseChart, update: Update, count = 4) {
  const r10 = composeSteeredPrompt(r9, r5, r6); // tool_1 compose
  update((s) => ({ ...s, r10 }));
  await startRound(update, Array(count).fill(r10), r9); // model_2 generate~
}

export function retryIllustration(update: Update, roundId: string, item: Illustration) {
  update((s) => ({
    ...s,
    r8Rounds: s.r8Rounds.map((r) =>
      r.id !== roundId ? r : { ...r, items: r.items.map((it) => (it.id === item.id ? { ...it, status: "pending" } : it)) },
    ),
  }));
  return illustrateInto(update, roundId, item.id, item.prompt);
}

/** model_5 generate~ for one variant, keeping the previous output in history. */
export async function generateVariant(update: Update, v: Variant) {
  const patch = (fn: (x: Variant) => Variant) => update((s) => ({ ...s, r19: s.r19.map((x) => (x.id === v.id ? fn(x) : x)) }));
  patch((x) => ({ ...x, status: "pending", error: undefined, history: x.svg ? [...x.history, x.svg].slice(-5) : x.history }));
  try {
    const { svg } = await api.variant(v.prompt, v.aspect);
    patch((x) => ({ ...x, status: "done", svg }));
  } catch (e) {
    patch((x) => ({ ...x, status: "error", error: errMsg(e) }));
  }
}

/** Process 5: r11 + r13* + r14* + r1 -> r15*,r16* -> r17* -> r18* -> r19* */
export async function runProcess5(state: AppState, update: Update) {
  const { r11, r13, r14, r1 } = state as { r11: { svg: string }; r13: Segment[]; r14: SegmentLabel[]; r1: Dataset };
  const crops: Crop[] = cropSegments(r11.svg, r13, r14).map((c) => ({ ...c, descStatus: "pending" })); // tool_2 extract
  update((s) => ({ ...s, crops, r19: [] }));
  const described = await Promise.all(
    crops.map(async (c) => {
      try {
        const { r17 } = await api.describe(c.svg, { name: c.name, field: c.field }); // model_4 generate~
        return { ...c, description: r17, descStatus: "done" as const };
      } catch {
        return { ...c, description: c.name, descStatus: "error" as const };
      }
    }),
  );
  const r18 = composeVariantPrompts(described, r1); // tool_1 compose
  update((s) => ({ ...s, crops: described, r19: r18 }));
  await Promise.all(r18.map((v) => generateVariant(update, v))); // model_5 generate~
}
