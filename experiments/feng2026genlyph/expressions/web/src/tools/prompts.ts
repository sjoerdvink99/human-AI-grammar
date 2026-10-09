import type { Keyword, Fragment, Attributes } from '../types';

/** [tool_1 extract] keyword_response_1 -> keywords_1* */
export function parseKeywords(response: string): Keyword[] {
  const seen = new Set<string>();
  const out: Keyword[] = [];
  for (const line of response.split(/\r?\n/)) {
    const m = line.replace(/^[\s\-*\d.)]+/, '').match(/^(.+?)\s*\|\s*(\d+(?:\.\d+)?)/);
    if (!m) continue;
    const text = m[1].trim().toLowerCase();
    if (!text || seen.has(text) || text.length > 40) continue;
    seen.add(text);
    out.push({ text, weight: Math.max(1, Math.min(10, Number(m[2]))), active: true });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

const STYLE = 'Flat vector icon, simple shapes, clearly separated parts, centred, transparent background.';

/** [tool_1 compose] keywords_1* + word_cloud_1 -> image_prompts_1* (one per top keyword) */
export function composeImagePrompts(keywords: Keyword[], datasetName: string, n = 4): string[] {
  const active = keywords.filter((k) => k.active);
  const context = active.slice(0, 8).map((k) => k.text).join(', ');
  return active.slice(0, n).map(
    (k) => `Draw a pictorial glyph of: ${k.text}. Theme of the dataset "${datasetName}"; related concepts: ${context}. ${STYLE}`,
  );
}

/** [tool_1 compose] concept_prompt_1 (+ keywords) -> image_prompt_2 */
export function composeConceptPrompt(concept: string, keywords: Keyword[]): string {
  const ctx = keywords.filter((k) => k.active).slice(0, 6).map((k) => k.text).join(', ');
  return `Draw a pictorial glyph of: ${concept.trim()}.${ctx ? ` Related concepts: ${ctx}.` : ''} ${STYLE}`;
}

/** [tool_1 compose] fragment_descriptions_1* + attribute_mappings_1* + dataset_1 -> encoding_prompts_1* */
export function composeEncodingPrompts(
  fragments: Fragment[],
  attrs: Attributes,
): { maskId: string; value: string; prompt: string }[] {
  const out: { maskId: string; value: string; prompt: string }[] = [];
  for (const f of fragments) {
    const a = attrs.find((x) => x.name === f.attribute);
    if (!a || a.kind !== 'categorical') continue;
    const values = a.categories!;
    for (const v of values) {
      const others = values.filter((o) => o !== v).join(', ');
      out.push({
        maskId: f.maskId,
        value: v,
        prompt:
          `This fragment is "${f.name}"${f.description ? ` — ${f.description}` : ''}. ` +
          `Redraw it to represent ${a.name} = "${v}" (other values: ${others}). ` +
          `Use a distinctive style evoking "${v}" while keeping the same silhouette, position and size.`,
      });
    }
  }
  return out;
}
