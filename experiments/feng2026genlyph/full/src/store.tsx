import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type {
  AssemblySettings, Attribute, AttributeMapping, CandidateImage, CategoricalFragment, Dataset, EncodingPrompt,
  Fragment, FragmentContour, FragmentEdges, GlyphImage, Keyword, Layout, LayoutRecommendation, Mask,
  PlacementSettings, Region, WordCloudItem,
} from './types';

export type Status = 'idle' | 'loading' | 'done' | 'error';

export interface ConceptImages {
  concept: string;
  prompt: string;
  status: Status;
  images: CandidateImage[];
  error?: string;
}

/** one round of process 2 (concept_prompt_1 -> image_prompt_2 -> candidate_images_2) */
export interface RefineRound {
  id: string;
  conceptPrompt: string;
  imagePrompt: string;
  status: Status;
  images: CandidateImage[];
  error?: string;
}

export interface PendingRegion extends Region {
  status: Status;
  error?: string;
}

export interface AppState {
  step: number;
  // process 1
  dataset: Dataset | null;
  attributes: Attribute[];
  datasetDescription: string;
  keywordStatus: Status;
  keywordError?: string;
  keywordResponse: string;
  keywords: Keyword[];
  wordCloud: WordCloudItem[];
  candidates1: ConceptImages[];
  // process 2
  conceptPrompt: string;
  rounds: RefineRound[];
  // process 3
  glyphImage: GlyphImage | null;
  // process 4
  regions: PendingRegion[];
  masks: Mask[];
  mappings: AttributeMapping[];
  // process 5
  fragments: Fragment[];
  fragmentEdges: FragmentEdges[];
  descriptions: Record<string, string>;
  describeStatus: Status;
  describeError?: string;
  encodingPrompts: EncodingPrompt[];
  categoricalFragments: CategoricalFragment[];
  /** key `${maskId}|${value}` or `${maskId}|*` */
  encodeStatus: Record<string, Status>;
  encodeErrors: Record<string, string>;
  // process 6
  contours: FragmentContour[];
  assembly: AssemblySettings | null;
  // process 7
  placement: PlacementSettings;
  recommendation: LayoutRecommendation | null;
  layout: Layout | null;
}

export const initialState: AppState = {
  step: 1,
  dataset: null,
  attributes: [],
  datasetDescription: '',
  keywordStatus: 'idle',
  keywordResponse: '',
  keywords: [],
  wordCloud: [],
  candidates1: [],
  conceptPrompt: '',
  rounds: [],
  glyphImage: null,
  regions: [],
  masks: [],
  mappings: [],
  fragments: [],
  fragmentEdges: [],
  descriptions: {},
  describeStatus: 'idle',
  encodingPrompts: [],
  categoricalFragments: [],
  encodeStatus: {},
  encodeErrors: {},
  contours: [],
  assembly: null,
  placement: { theme: 'light', emphasis: [] },
  recommendation: null,
  layout: null,
};

type Updater = Partial<AppState> | ((s: AppState) => Partial<AppState>);
interface Store {
  s: AppState;
  set: (u: Updater) => void;
  /** latest state, for async callbacks */
  get: () => AppState;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AppState>(initialState);
  const ref = useRef(s);
  ref.current = s;
  const set = useCallback((u: Updater) => {
    setS((prev) => {
      const next = { ...prev, ...(typeof u === 'function' ? u(prev) : u) };
      ref.current = next;
      return next;
    });
  }, []);
  const get = useCallback(() => ref.current, []);
  return <Ctx.Provider value={{ s, set, get }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const c = useContext(Ctx);
  if (!c) throw new Error('no store');
  return c;
}

let n = 0;
export const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;
