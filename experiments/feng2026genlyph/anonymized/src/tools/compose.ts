import type { BaseChart, Crop, Dataset, Variant } from "../types.ts";
import { fmt } from "./profile.ts";

/** Text rendering of r6's shape, so the compose steps can carry the chart into a prompt. */
export function describeShape(r6: BaseChart): string {
  const max = Math.max(...r6.bars.map((b) => b.value), 1);
  const items = r6.bars.map((b) => `${b.category} (${fmt(b.value)}, ${Math.round((100 * b.value) / max)}% of largest)`);
  return `The data has ${r6.bars.length} categories of "${r6.categoryField}" with ${r6.valueField || "counts"}: ${items.join("; ")}.`;
}

function shapeInstruction(r6: BaseChart): string {
  return `${describeShape(r6)}
Depict exactly ${r6.bars.length} clearly separated, similar objects arranged left to right in that order, one per category,
each drawn so its size roughly matches its share above. Keep the objects visually distinct from the background so they can
be cut out later.`;
}

/** tool_1 compose: r5* + r6 -> r7* (one illustration prompt per concept, at most `limit`) */
export function composeIllustrationPrompts(r5: string[], r6: BaseChart, limit = 4): string[] {
  return r5.slice(0, limit).map((concept) => `Create an illustration for this concept: ${concept}\n${shapeInstruction(r6)}`);
}

/** tool_1 compose: r9 + r5* + r6 -> r10 */
export function composeSteeredPrompt(r9: string, concepts: string[], r6: BaseChart): string {
  const conceptLine = concepts.length ? `Draw on these concepts: ${concepts.join(" | ")}\n` : "";
  return `Create an illustration following the user's direction: ${r9.trim()}\n${conceptLine}${shapeInstruction(r6)}`;
}

/** tool_1 compose: r17* + r16* + r14* + r1 -> r18* (one variant prompt per category value) */
export function composeVariantPrompts(crops: Crop[], r1: Dataset, maxCategories = 10): Variant[] {
  const out: Variant[] = [];
  for (const c of crops) {
    const categories = [
      ...new Set(r1.rows.map((r) => r[c.field]).filter((v) => v !== null && v !== undefined).map(String)),
    ].slice(0, maxCategories);
    for (const category of categories) {
      out.push({
        id: `${c.segmentId}::${category}`,
        segmentId: c.segmentId,
        category,
        aspect: c.bbox,
        history: [],
        prompt: `Draw a single "${c.name}" icon that represents the ${c.field} "${category}".
Reference element: ${c.description ?? c.name}
Keep exactly the same drawing style, outline weight, palette family and proportions as the reference, but change its
appearance (shape details, colour, attributes) so that it unmistakably reads as "${category}". All icons in the set
must look like siblings.`,
      });
    }
  }
  return out;
}
