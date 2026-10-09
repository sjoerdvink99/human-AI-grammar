// tool_1 = data processing and prompt construction utilities
import Papa from 'papaparse';
import type { Attribute, AttributeMapping, Dataset, EncodingPrompt, Keyword } from '../types';

export const MAX_CATEGORIES = 12;
export const MAX_ROWS = 300;

export function parseCsv(text: string, name: string): Dataset {
  const res = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const columns = (res.meta.fields ?? []).filter((c) => c.trim() !== '');
  if (columns.length === 0) throw new Error('CSV has no header row');
  const rows = res.data.slice(0, MAX_ROWS).map((r) => {
    const o: Record<string, string> = {};
    for (const c of columns) o[c] = (r[c] ?? '').toString().trim();
    return o;
  });
  if (rows.length === 0) throw new Error('CSV has no data rows');
  return { name, columns, rows };
}

const isNum = (v: string) => v !== '' && Number.isFinite(Number(v));

/** [tool_1 extract] dataset_1 -> attributes_1 */
export function extractAttributes(ds: Dataset): Attribute[] {
  return ds.columns.map((name) => {
    const vals = ds.rows.map((r) => r[name]).filter((v) => v !== '');
    const numeric = vals.length > 0 && vals.every(isNum);
    if (numeric) {
      const nums = vals.map(Number);
      return { name, kind: 'numerical', values: [], min: Math.min(...nums), max: Math.max(...nums), usable: true };
    }
    const distinct = [...new Set(vals)];
    return { name, kind: 'categorical', values: distinct, min: 0, max: 0, usable: distinct.length <= MAX_CATEGORIES };
  });
}

/** [tool_1 translate] attributes_1 -> dataset_description_1 */
export function describeDataset(ds: Dataset, attrs: Attribute[]): string {
  const lines = attrs.map((a) => {
    if (a.kind === 'numerical') return `- "${a.name}": numerical, range ${a.min} to ${a.max}`;
    const sample = a.values.slice(0, 8).join(', ');
    return `- "${a.name}": categorical with ${a.values.length} distinct values (${sample}${a.values.length > 8 ? ', …' : ''})` +
      (a.usable ? '' : ' — identifier-like, not encoded');
  });
  return `The dataset "${ds.name}" has ${ds.rows.length} rows; each row will become one glyph. Attributes:\n${lines.join('\n')}`;
}

/** [tool_1 extract] keyword_response_1 -> keywords_1* */
export function extractKeywords(response: string): Keyword[] {
  let items: unknown[] = [];
  try {
    const start = response.indexOf('{');
    const parsed = JSON.parse(response.slice(start, response.lastIndexOf('}') + 1));
    items = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  } catch {
    // fall back: comma / newline separated list
    items = response.split(/[\n,]/).map((w) => ({ word: w.replace(/^[\s\-*\d.]+/, ''), weight: 5 }));
  }
  const out: Keyword[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const o = it as { word?: unknown; weight?: unknown; reason?: unknown };
    const word = String(o.word ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N} '-]/gu, '');
    if (!word || word.split(/\s+/).length > 3 || seen.has(word)) continue;
    seen.add(word);
    const w = Number(o.weight);
    out.push({ word, weight: Number.isFinite(w) ? Math.min(10, Math.max(1, w)) : 5, reason: o.reason ? String(o.reason) : undefined });
  }
  return out.slice(0, 10);
}

/** [tool_1 compose] keyword -> image prompt (shared by image_prompts_1 and image_prompt_2) */
export function composeImagePrompt(concept: string): string {
  return `A figurative glyph of: ${concept.trim()}. Simple, iconic, flat vector illustration with several clearly separated parts that can later be recoloured, resized or repeated to encode data.`;
}

/** [tool_1 compose] keywords_1* -> image_prompts_1* */
export function composeImagePrompts(keywords: Keyword[]): { concept: string; prompt: string }[] {
  return keywords.map((k) => ({ concept: k.word, prompt: composeImagePrompt(k.word) }));
}

/** [tool_1 compose] fragment descriptions + mappings + dataset -> encoding_prompts_1* */
export function composeEncodingPrompts(
  mappings: AttributeMapping[],
  descriptions: Record<string, string>,
  attrs: Attribute[],
): EncodingPrompt[] {
  const out: EncodingPrompt[] = [];
  for (const m of mappings) {
    if (!m.categorical) continue;
    const attr = attrs.find((a) => a.name === m.categorical);
    if (!attr) continue;
    const desc = descriptions[m.maskId] ?? 'the part';
    for (const value of attr.values) {
      const others = attr.values.filter((v) => v !== value).join(', ');
      out.push({
        maskId: m.maskId,
        attribute: attr.name,
        value,
        prompt: `${desc}, coloured and textured to evoke "${value}" (${attr.name}); must look clearly different from: ${others || 'nothing else'}.`,
      });
    }
  }
  return out;
}
