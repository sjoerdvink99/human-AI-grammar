// Representations from design.json, named after their identifiers without version.

export type Cell = string | number;
/** (dataset_1: artifact tabular) */
export interface Dataset { name: string; columns: string[]; rows: Record<string, Cell>[] }

export type AttributeKind = 'numeric' | 'categorical' | 'id';
export interface Attribute {
  name: string;
  kind: AttributeKind;
  min?: number;
  max?: number;
  categories?: string[];
}
/** (attributes_1: artifact record) */
export type Attributes = Attribute[];

/** (keywords_1: artifact language)* */
export interface Keyword { text: string; weight: number; active: boolean }

/** (candidate_images_n: artifact visual)* — kept per round */
export interface CandidateRound {
  id: number;
  source: 'keywords' | 'concept';
  prompts: string[]; // image_prompts_1 or image_prompt_2
  conceptPrompt?: string;
  images: ({ svg: string } | { error: string } | { pending: true })[];
}

/** (regions_1: selection spatial)* */
export interface Region { x: number; y: number; w: number; h: number }

/** (masks_n: artifact spatial)* */
export interface Mask { id: string; name: string; color: string; eids: string[] }

/** (attribute_mappings_1: label record)* */
export interface AttributeMapping { maskId: string; attribute: string; kind: 'categorical' | 'numeric' }

export interface BBox { x: number; y: number; w: number; h: number }

/** (fragments_1: artifact visual)* + (fragment_edges_1: artifact spatial)* */
export interface Fragment {
  maskId: string;
  name: string;
  attribute: string;
  svg: string; // standalone SVG cropped to edge
  inner: string; // inner markup in glyph coordinates
  edge: BBox; // fragment_edges_1
  description?: string; // fragment_descriptions_1
}

/** (encoding_prompts_1: instruction language)* + (categorical_fragments_1: artifact visual)* */
export interface EncodingVariant {
  maskId: string;
  value: string;
  prompt: string;
  versions: string[]; // categorical fragment SVG versions (latest last)
  current: number;
  status: 'idle' | 'pending' | 'error';
  error?: string;
}

/** (fragment_contours_1: artifact spatial)* */
export interface Contour { maskId: string; bbox: BBox; hull: [number, number][]; anchor: [number, number] }

export type NumericChannel = 'scale' | 'opacity' | 'lightness' | 'rotate' | 'stretchY' | 'stretchX';
/** (assembly_settings_1: instruction record) */
export interface AssemblySettings {
  glyphSize: number;
  showBase: boolean;
  numeric: Record<string, { channel: NumericChannel; from: number; to: number; anchor: 'center' | 'bottom' | 'top' }>;
}

/** (glyphs_1: artifact visual)* */
export interface Glyph { rowIndex: number; svgInner: string; viewBox: string }

/** (placement_settings_1: instruction record) */
export interface PlacementSettings {
  xAttr: string;
  yAttr: string;
  sortAttr: string;
  groupAttr: string;
  labelAttr: string;
  glyphSize: number;
  width: number;
}

export type LayoutType = 'grid' | 'sortedGrid' | 'scatter' | 'groupedGrid' | 'circular';
/** (layout_recommendation_1: artifact record) */
export interface LayoutOption { type: LayoutType; score: number; reason: string }
/** (layout_1: instruction record) */
export interface Layout { type: LayoutType; padding: number; showLabels: boolean; showAxes: boolean }

/** (export_request_1: instruction categorical) */
export type ExportRequest = 'png' | 'svg';
