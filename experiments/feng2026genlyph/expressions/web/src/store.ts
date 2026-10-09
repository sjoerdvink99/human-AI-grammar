import { create } from 'zustand';
import type {
  AssemblySettings, AttributeMapping, Attributes, CandidateRound, Contour, Dataset, EncodingVariant, Fragment,
  Glyph, Keyword, Layout, LayoutOption, Mask, PlacementSettings, Region,
} from './types';
import { describeDataset, extractAttributes, parseCsv } from './tools/attributes';
import { composeConceptPrompt, composeEncodingPrompts, composeImagePrompts, parseKeywords } from './tools/prompts';
import { elementInfos, extractFragments, type Skeleton } from './tools/fragments';
import { extractContours } from './tools/contours';
import { composeGlyphs, numericalFragments } from './tools/assemble';
import { composeFGV, recommendLayouts } from './tools/layout';
import { MASK_COLORS, prefixIds } from './tools/svgutil';

async function api<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}

let uid = 0;
const nextId = (p: string) => `${p}${++uid}`;

export interface State {
  tab: number;
  busy: Record<string, boolean>;
  error: string | null;
  // process 1
  dataset: Dataset | null;
  attributes: Attributes;
  datasetDescription: string;
  keywordResponse: string;
  keywords: Keyword[];
  imagePrompts: string[];
  // processes 1–3
  candidateRounds: CandidateRound[];
  conceptPrompt: string;
  glyphImage: string | null;
  glyphSource: string | null;
  // process 4
  regions: Region[];
  masks: Mask[];
  masksVersion: 1 | 2;
  activeMask: string | null;
  attributeMappings: AttributeMapping[];
  // process 5
  fragments: Fragment[];
  skeleton: Skeleton | null;
  encodingVariants: EncodingVariant[];
  // process 6
  contours: Contour[];
  assemblySettings: AssemblySettings;
  glyphs: Glyph[];
  // process 7
  placementSettings: PlacementSettings;
  layoutRecommendation: LayoutOption[];
  layout: Layout | null;
  fgv: string | null;
}

const initial: State = {
  tab: 0, busy: {}, error: null,
  dataset: null, attributes: [], datasetDescription: '', keywordResponse: '', keywords: [], imagePrompts: [],
  candidateRounds: [], conceptPrompt: '', glyphImage: null, glyphSource: null,
  regions: [], masks: [], masksVersion: 1, activeMask: null, attributeMappings: [],
  fragments: [], skeleton: null, encodingVariants: [],
  contours: [], assemblySettings: { glyphSize: 256, showBase: true, numeric: {} }, glyphs: [],
  placementSettings: { xAttr: '', yAttr: '', sortAttr: '', groupAttr: '', labelAttr: '', glyphSize: 72, width: 900 },
  layoutRecommendation: [], layout: null, fgv: null,
};

type Set = (p: Partial<State> | ((s: State) => Partial<State>)) => void;

export const useStore = create<State>(() => initial);
const set: Set = useStore.setState;
const get = useStore.getState;

async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  set((s) => ({ busy: { ...s.busy, [key]: true }, error: null }));
  try {
    return await fn();
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set((s) => ({ busy: { ...s.busy, [key]: false } }));
  }
}

export const actions = {
  setTab: (tab: number) => set({ tab }),
  clearError: () => set({ error: null }),

  // ---------------- Process 1 ----------------
  loadCsv(text: string, name: string) {
    try {
      const dataset = parseCsv(text, name);
      const attributes = extractAttributes(dataset); // [tool_1 extract]
      const datasetDescription = describeDataset(dataset, attributes); // [tool_1 translate]
      const label = attributes.find((a) => a.kind === 'id')?.name || '';
      set({ ...initial, dataset, attributes, datasetDescription,
        placementSettings: { ...initial.placementSettings, labelAttr: label } });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  setAttributeKind(name: string, kind: Attributes[number]['kind']) {
    const s = get();
    if (!s.dataset) return;
    const attributes = s.attributes.map((a) => {
      if (a.name !== name) return a;
      if (kind === 'categorical') return { name, kind, categories: [...new Set(s.dataset!.rows.map((r) => String(r[name])))].sort() };
      if (kind === 'numeric') {
        const nums = s.dataset!.rows.map((r) => Number(r[name])).filter((v) => !isNaN(v));
        return { name, kind, min: Math.min(...nums), max: Math.max(...nums) };
      }
      return { name, kind, categories: [] };
    });
    set({ attributes, datasetDescription: describeDataset(s.dataset, attributes) });
  },
  generateKeywords: () =>
    withBusy('keywords', async () => {
      const { text } = await api<{ text: string }>('keywords', { description: get().datasetDescription }); // [model_1 generate]~
      const keywords = parseKeywords(text); // [tool_1 extract]
      if (!keywords.length) throw new Error('No keywords could be parsed from the model response');
      set({ keywordResponse: text, keywords });
    }),
  toggleKeyword: (text: string) =>
    set((s) => ({ keywords: s.keywords.map((k) => (k.text === text ? { ...k, active: !k.active } : k)) })),

  async generateCandidates(prompts: string[], source: CandidateRound['source'], conceptPrompt?: string) {
    const id = Date.now();
    const round: CandidateRound = { id, source, prompts, conceptPrompt, images: prompts.map(() => ({ pending: true as const })) };
    set((s) => ({ candidateRounds: [round, ...s.candidateRounds], error: null }));
    await Promise.all(
      prompts.map(async (prompt, i) => {
        let img: CandidateRound['images'][number];
        try {
          const { svg } = await api<{ svg: string }>('image', { prompt }); // [model_2 generate]~
          img = { svg };
        } catch (e) {
          img = { error: (e as Error).message };
        }
        set((s) => ({
          candidateRounds: s.candidateRounds.map((r) =>
            r.id === id ? { ...r, images: r.images.map((x, j) => (j === i ? img : x)) } : r),
        }));
      }),
    );
  },
  generateFromKeywords() {
    const s = get();
    const imagePrompts = composeImagePrompts(s.keywords, s.dataset?.name || 'dataset'); // [tool_1 compose]
    set({ imagePrompts });
    return actions.generateCandidates(imagePrompts, 'keywords');
  },

  // ---------------- Process 2 ----------------
  setConceptPrompt: (conceptPrompt: string) => set({ conceptPrompt }),
  generateFromConcept(n = 4) {
    const s = get();
    if (!s.conceptPrompt.trim()) return set({ error: 'Describe a concept first' });
    const imagePrompt2 = composeConceptPrompt(s.conceptPrompt, s.keywords); // [tool_1 compose]
    return actions.generateCandidates(Array(n).fill(imagePrompt2), 'concept', s.conceptPrompt);
  },
  retryImage(roundId: number, i: number) {
    const r = get().candidateRounds.find((x) => x.id === roundId);
    if (!r) return;
    return actions.generateCandidates([r.prompts[i]], r.source, r.conceptPrompt);
  },

  // ---------------- Process 3 ----------------
  selectGlyphImage(svg: string) {
    set({ ...pick(initial, 'regions', 'masks', 'masksVersion', 'activeMask', 'attributeMappings', 'fragments', 'skeleton',
      'encodingVariants', 'contours', 'glyphs', 'fgv', 'layout', 'layoutRecommendation'),
      glyphImage: prefixIds(svg, 'g'), glyphSource: svg, tab: 2 });
  },

  // ---------------- Process 4 ----------------
  addRegion: (r: Region) => set((s) => ({ regions: [...s.regions, r] })),
  clearRegions: () => set({ regions: [] }),
  extractMasks: () =>
    withBusy('segment', async () => {
      const s = get();
      if (!s.glyphImage || !s.regions.length) throw new Error('Draw at least one region on the image');
      const elements = elementInfos(s.glyphImage);
      const { masks } = await api<{ masks: { region: number; name: string; eids: string[] }[] }>('segment', {
        svg: s.glyphImage, elements, regions: s.regions,
      }); // [model_3 extract]
      const existing = get().masks;
      const created: Mask[] = masks.map((m, i) => ({
        id: nextId('m'), name: m.name, eids: m.eids, color: MASK_COLORS[(existing.length + i) % MASK_COLORS.length],
      }));
      // masks are disjoint: newer masks claim their elements
      const claimed = new Set(created.flatMap((m) => m.eids));
      const kept = existing.map((m) => ({ ...m, eids: m.eids.filter((e) => !claimed.has(e)) }));
      set({ masks: [...kept, ...created], masksVersion: 1, regions: [], activeMask: created[0]?.id ?? null });
    }),
  setActiveMask: (activeMask: string | null) => set({ activeMask }),
  /** [human modify] masks_1 -> masks_2: toggle an element in the active mask */
  toggleElement(eid: string) {
    const s = get();
    if (!s.activeMask) return;
    set({
      masksVersion: 2,
      masks: s.masks.map((m) =>
        m.id === s.activeMask
          ? { ...m, eids: m.eids.includes(eid) ? m.eids.filter((e) => e !== eid) : [...m.eids, eid] }
          : { ...m, eids: m.eids.filter((e) => e !== eid) }),
    });
  },
  addEmptyMask() {
    const s = get();
    const m: Mask = { id: nextId('m'), name: `part ${s.masks.length + 1}`, eids: [], color: MASK_COLORS[s.masks.length % MASK_COLORS.length] };
    set({ masks: [...s.masks, m], activeMask: m.id, masksVersion: 2 });
  },
  renameMask: (id: string, name: string) => set((s) => ({ masksVersion: 2, masks: s.masks.map((m) => (m.id === id ? { ...m, name } : m)) })),
  deleteMask: (id: string) =>
    set((s) => ({
      masksVersion: 2, masks: s.masks.filter((m) => m.id !== id),
      attributeMappings: s.attributeMappings.filter((x) => x.maskId !== id),
      activeMask: s.activeMask === id ? null : s.activeMask,
    })),
  /** [human assign] -> attribute_mappings_1 */
  assign(maskId: string, kind: 'categorical' | 'numeric', attribute: string) {
    set((s) => {
      const rest = s.attributeMappings.filter((x) => !(x.maskId === maskId && x.kind === kind));
      return { attributeMappings: attribute ? [...rest, { maskId, kind, attribute }] : rest };
    });
  },

  // ---------------- Process 5 ----------------
  prepareFragments: () =>
    withBusy('describe', async () => {
      const s = get();
      if (!s.glyphImage) throw new Error('Select a glyph image first');
      if (!s.attributeMappings.length) throw new Error('Assign at least one attribute to a mask');
      const { fragments, skeleton } = extractFragments(s.glyphImage, s.masks, s.attributeMappings); // [tool_2 extract]
      set({ fragments, skeleton, tab: 3 });
      const { descriptions } = await api<{ descriptions: string[] }>('describe', {
        glyphSvg: s.glyphImage,
        fragments: fragments.map((f) => ({ name: f.name, attribute: f.attribute, svg: f.svg })),
      }); // [model_4 generate]~
      const described = fragments.map((f, i) => ({ ...f, description: descriptions[i] }));
      const catFrags = described.map((f) => {
        const m = s.attributeMappings.find((x) => x.maskId === f.maskId && x.kind === 'categorical');
        return m ? { ...f, attribute: m.attribute } : null;
      }).filter(Boolean) as Fragment[];
      const prompts = composeEncodingPrompts(catFrags, s.attributes); // [tool_1 compose]
      set({
        fragments: described,
        encodingVariants: prompts.map((p) => ({ ...p, versions: [], current: 0, status: 'idle' })),
      });
    }),
  setEncodingPrompt: (maskId: string, value: string, prompt: string) =>
    set((s) => ({ encodingVariants: s.encodingVariants.map((v) => (v.maskId === maskId && v.value === value ? { ...v, prompt } : v)) })),
  async generateVariant(maskId: string, value: string) {
    const upd = (p: Partial<EncodingVariant>) =>
      set((s) => ({ encodingVariants: s.encodingVariants.map((v) => (v.maskId === maskId && v.value === value ? { ...v, ...p } : v)) }));
    const s = get();
    const v = s.encodingVariants.find((x) => x.maskId === maskId && x.value === value)!;
    const f = s.fragments.find((x) => x.maskId === maskId)!;
    upd({ status: 'pending', error: undefined });
    try {
      const vb = [f.edge.x, f.edge.y, f.edge.w, f.edge.h].map((n) => +n.toFixed(2)).join(' ');
      const { svg } = await api<{ svg: string }>('variant', { fragmentSvg: f.svg, viewBox: vb, prompt: v.prompt }); // [model_5 generate]~
      const cur = get().encodingVariants.find((x) => x.maskId === maskId && x.value === value)!;
      const versions = [...cur.versions, prefixIds(svg, nextId('v'))];
      upd({ status: 'idle', versions, current: versions.length - 1 });
    } catch (e) {
      upd({ status: 'error', error: (e as Error).message });
    }
  },
  generateAllVariants: () =>
    Promise.all(get().encodingVariants.filter((v) => !v.versions.length).map((v) => actions.generateVariant(v.maskId, v.value))),
  setVariantVersion: (maskId: string, value: string, current: number) =>
    set((s) => ({ encodingVariants: s.encodingVariants.map((v) => (v.maskId === maskId && v.value === value ? { ...v, current } : v)) })),

  // ---------------- Process 6 ----------------
  extractContours: () =>
    withBusy('contours', async () => {
      const s = get();
      const contours = await extractContours(s.fragments, s.encodingVariants); // [tool_3 extract]
      const numeric = { ...s.assemblySettings.numeric };
      for (const m of s.attributeMappings.filter((x) => x.kind === 'numeric'))
        numeric[m.attribute] ??= { channel: 'scale', from: 0.5, to: 1.4, anchor: 'center' };
      set({ contours, assemblySettings: { ...s.assemblySettings, numeric }, tab: 4 });
      actions.assemble();
    }),
  /** [human specify]/[human modify] assembly_settings_1 */
  setAssembly(p: Partial<AssemblySettings>) {
    set((s) => ({ assemblySettings: { ...s.assemblySettings, ...p } }));
    actions.assemble();
  },
  assemble() {
    const s = get();
    if (!s.dataset || !s.skeleton) return;
    const nf = numericalFragments(s.dataset, s.attributes, s.attributeMappings, s.contours, s.assemblySettings); // [tool_3 translate]
    const glyphs = composeGlyphs(s.dataset, s.skeleton, s.fragments, s.encodingVariants, s.attributeMappings, nf, s.assemblySettings); // [tool_3 compose]
    set({ glyphs });
    if (s.layout) actions.composeFGV();
  },

  // ---------------- Process 7 ----------------
  setPlacement(p: Partial<PlacementSettings>) {
    set((s) => ({ placementSettings: { ...s.placementSettings, ...p } }));
    const s = get();
    set({ layoutRecommendation: recommendLayouts(s.placementSettings, s.attributes, s.dataset!) }); // [tool_4 match]
    if (s.layout) actions.composeFGV();
  },
  recommend() {
    const s = get();
    set({ layoutRecommendation: recommendLayouts(s.placementSettings, s.attributes, s.dataset!), tab: 5 });
  },
  /** [human select] layout_recommendation_1 -> layout_1 */
  selectLayout(type: Layout['type']) {
    set((s) => ({ layout: { padding: 8, showLabels: true, showAxes: true, ...s.layout, type } }));
    actions.composeFGV();
  },
  setLayout(p: Partial<Layout>) {
    set((s) => ({ layout: s.layout ? { ...s.layout, ...p } : null }));
    actions.composeFGV();
  },
  composeFGV() {
    const s = get();
    if (!s.layout || !s.dataset) return;
    set({ fgv: composeFGV(s.glyphs, s.dataset, s.attributes, s.placementSettings, s.layout) }); // [tool_3 compose]
  },
};

function pick<T extends object, K extends keyof T>(o: T, ...keys: K[]): Pick<T, K> {
  const r = {} as Pick<T, K>;
  for (const k of keys) r[k] = o[k];
  return r;
}
