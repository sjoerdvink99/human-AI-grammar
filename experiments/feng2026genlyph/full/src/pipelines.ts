// Process 5 — Generate and refine categorical encodings (automatic chain after submit)
import { api } from './api';
import type { AppState } from './store';
import { blobToBase64, svgToPng } from './tools/svg';
import { composeEncodingPrompts } from './tools/tool1';
import { extractFragments } from './tools/tool2';
import type { EncodingPrompt } from './types';

type Set = (u: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type Get = () => AppState;

export async function runCategoricalPipeline(get: Get, set: Set) {
  const st = get();
  const gi = st.glyphImage!;
  const masks = st.masks.filter((m) => m.gids.length > 0);
  const mappings = st.mappings.filter((m) => masks.some((x) => x.id === m.maskId));
  // [tool_2 extract]
  const { fragments, edges } = extractFragments(gi, masks);
  set({
    masks, mappings, fragments, fragmentEdges: edges, descriptions: {}, describeStatus: 'loading', describeError: undefined,
    encodingPrompts: [], categoricalFragments: [], encodeStatus: {}, encodeErrors: {}, contours: [], assembly: null, step: 4,
  });

  // [model_4 generate]~ fragments -> fragment_descriptions
  const descriptions: Record<string, string> = {};
  try {
    await Promise.all(fragments.map(async (f) => {
      const png = await blobToBase64(await svgToPng(f.svg, 256, 256, '#ffffff'));
      const { description } = await api.describe(png);
      descriptions[f.maskId] = description;
      set((s) => ({ descriptions: { ...s.descriptions, [f.maskId]: description } }));
    }));
    set({ describeStatus: 'done' });
  } catch (e) {
    set({ describeStatus: 'error', describeError: (e as Error).message });
    return;
  }

  // [tool_1 compose] -> encoding_prompts
  const encodingPrompts = composeEncodingPrompts(mappings, descriptions, st.attributes);
  set({ encodingPrompts });

  // [model_5 generate]~ per fragment (all its category values in one call)
  await Promise.all(
    [...new Set(encodingPrompts.map((p) => p.maskId))].map((maskId) =>
      generateEncodings(get, set, encodingPrompts.filter((p) => p.maskId === maskId))),
  );
}

/** [model_5 generate]~ for a set of prompts of one fragment (also used for regeneration) */
export async function generateEncodings(get: Get, set: Set, prompts: EncodingPrompt[]) {
  if (prompts.length === 0) return;
  const maskId = prompts[0].maskId;
  const keys = prompts.map((p) => `${maskId}|${p.value}`);
  set((s) => ({
    encodeStatus: { ...s.encodeStatus, ...Object.fromEntries(keys.map((k) => [k, 'loading'])) },
    encodeErrors: Object.fromEntries(Object.entries(s.encodeErrors).filter(([k]) => !keys.includes(k))),
  }));
  const edges = get().fragmentEdges.find((e) => e.maskId === maskId);
  try {
    if (!edges) throw new Error('missing fragment edges');
    const { variants } = await api.encode(edges.edges, prompts.map((p) => ({ value: p.value, prompt: p.prompt })));
    set((s) => ({
      categoricalFragments: [
        ...s.categoricalFragments.filter((c) => !(c.maskId === maskId && prompts.some((p) => p.value === c.value))),
        ...variants.map((v) => ({ maskId, value: v.value, styles: v.styles })),
      ],
      encodeStatus: { ...s.encodeStatus, ...Object.fromEntries(keys.map((k) => [k, 'done'])) },
    }));
  } catch (e) {
    const msg = (e as Error).message;
    set((s) => ({
      encodeStatus: { ...s.encodeStatus, ...Object.fromEntries(keys.map((k) => [k, 'error'])) },
      encodeErrors: { ...s.encodeErrors, ...Object.fromEntries(keys.map((k) => [k, msg])) },
    }));
  }
}
