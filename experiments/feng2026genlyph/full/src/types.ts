// Representations of the design, named after their identifiers (without version).

export type Row = Record<string, string>;
/** (dataset_1: artifact tabular) */
export interface Dataset {
  name: string;
  columns: string[];
  rows: Row[];
}

/** (attributes_1: artifact record) — one per column */
export interface Attribute {
  name: string;
  kind: 'categorical' | 'numerical';
  /** categorical: distinct values (in order of appearance) */
  values: string[];
  min: number;
  max: number;
  /** false for high-cardinality text columns (identifiers) — not mappable */
  usable: boolean;
}

/** (keywords_1: artifact language)* */
export interface Keyword {
  word: string;
  weight: number;
  reason?: string;
}

/** (word_cloud_1: artifact visual) — placed words, rendered as SVG */
export interface WordCloudItem {
  word: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

/** (candidate_images_1|2: artifact visual)* */
export interface CandidateImage {
  id: string;
  concept: string;
  prompt: string;
  title: string;
  svg: string;
}

export type BBox = [number, number, number, number]; // x, y, w, h

/** A primitive shape of the normalised glyph image */
export interface Shape {
  gid: string;
  tag: string;
  /** leaf markup with baked style and absolute transform, carries data-gid */
  markup: string;
  bbox: BBox;
  fill: string;
}

/** (glyph_image_1: artifact visual) */
export interface GlyphImage {
  sourceId: string;
  concept: string;
  width: number;
  height: number;
  minX: number;
  minY: number;
  defs: string;
  shapes: Shape[];
}

/** (regions_1: selection spatial) */
export interface Region {
  id: string;
  box: BBox;
}

/** (masks_1|2: artifact spatial) */
export interface Mask {
  id: string;
  name: string;
  box: BBox;
  gids: string[];
  color: string;
}

/** (attribute_mappings_1: label record) */
export interface AttributeMapping {
  maskId: string;
  categorical: string | null;
  numerical: string | null;
}

/** (fragments_1: artifact visual) */
export interface Fragment {
  maskId: string;
  name: string;
  svg: string; // cropped standalone SVG
  bbox: BBox;
  shapes: Shape[];
}

/** (fragment_edges_1: artifact spatial) */
export interface FragmentEdges {
  maskId: string;
  svg: string; // stroke-only edge rendering
  edges: { gid: string; tag: string; bbox: BBox }[];
}

/** (encoding_prompts_1: instruction language) */
export interface EncodingPrompt {
  maskId: string;
  attribute: string;
  value: string;
  prompt: string;
}

export type Texture = 'none' | 'stripes' | 'dots' | 'crosshatch' | 'waves' | 'grain';
export interface ShapeStyle {
  gid: string;
  fill: string;
  stroke: string;
  texture: Texture;
  textureColor: string;
}

/** (categorical_fragments_1: artifact visual) — one per (part, category value) */
export interface CategoricalFragment {
  maskId: string;
  value: string;
  styles: ShapeStyle[];
}

/** (fragment_contours_1: artifact spatial) */
export interface FragmentContour {
  maskId: string;
  bbox: BBox;
  cx: number;
  cy: number;
  /** convex hull of shape bboxes, used to draw the outline */
  outline: [number, number][];
}

export type NumericMode = 'size' | 'dup-h' | 'dup-v' | 'dup-path';
export interface PartAssembly {
  maskId: string;
  mode: NumericMode;
  minScale: number;
  maxScale: number;
  minCount: number;
  maxCount: number;
  /** gap between duplicated copies (px), or degrees for path duplication */
  spacing: number;
}
/** (assembly_settings_1: instruction record) */
export interface AssemblySettings {
  parts: PartAssembly[];
  /** bottom → top; 'base' is the unmapped remainder of the glyph image */
  layerOrder: string[];
}

/** (numerical_fragments_1: artifact visual) — per row, per part: transforms of its copies */
export interface NumericalFragment {
  row: number;
  maskId: string;
  transforms: string[];
}

/** (glyphs_1: artifact visual) */
export interface Glyph {
  row: number;
  svgInner: string; // content in the shared glyph viewBox
}
export interface GlyphSet {
  viewBox: BBox;
  glyphs: Glyph[];
  defs: string;
}

export type Theme = 'light' | 'dark' | 'paper';
/** (placement_settings_1: instruction record) */
export interface PlacementSettings {
  theme: Theme;
  emphasis: string[]; // ≤ 2 attribute names
}

export type LayoutType = 'grid' | 'sorted-grid' | 'grouped' | 'axis' | 'scatter' | 'matrix' | 'strip';
/** (layout_recommendation_1: artifact record) */
export interface LayoutRecommendation {
  recommended: LayoutType;
  alternatives: LayoutType[];
  rationale: string;
}

/** (layout_1: instruction record) */
export interface Layout {
  type: LayoutType;
  x: string | null;
  y: string | null;
  glyphSize: number;
  spacing: number;
  width: number;
  labelColumn: string | null;
  showAxes: boolean;
  title: string;
  overrides: Record<number, { x: number; y: number }>;
}
