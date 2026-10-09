// Typed application state. Names follow the design's identifiers (without version suffix).

export type Box = [number, number, number, number]; // x0, y0, x1, y1 in pixels

/** source_image: one version of the image the design starts from. */
export interface SourceVersion {
  id: string;
  file: string; // png file name inside the project directory
  width: number;
  height: number;
  parentId?: string;
  /** image_update: the request that produced this version (process 2). */
  instruction?: string;
  origin: 'upload' | 'generated' | 'refined';
  createdAt: number;
}

/** layer_plan: depth-ordered layers (depth 0 = front) and the elements on each. */
export interface LayerPlan {
  layers: PlanLayer[];
}
export interface PlanLayer {
  id: string;
  name: string;
  depth: number;
  elements: { id: string; name: string; description: string }[];
}

/** layer_items: descriptions of the elements to extract on each layer. */
export interface LayerItem {
  id: string;
  layerId: string;
  name: string;
  description: string;
  visualDetails: string;
}

/** detection_prompts / part_prompts: element locations for the segmenter. */
export interface DetectionPrompt {
  itemId: string;
  label: string;
  box: Box;
}

/** mask_quality: checks of mask confidence and bounding box fit. */
export interface MaskQuality {
  confidence: number;
  bboxIoU: number;
  areaRatio: number;
  pass: boolean;
  stage: 'initial' | 'refined' | 'fallback';
}

/** segments / grab_element / repaired_geometry / split_parts: an element as a vector shape. */
export interface Element {
  id: string;
  name: string;
  layerId: string;
  origin: 'segment' | 'fallback' | 'background' | 'grab' | 'repair' | 'split' | 'bridge' | 'frame';
  width: number; // local pixel size of mask/texture
  height: number;
  path: string; // SVG path data (local px, evenodd)
  mask: string; // png file (white = inside)
  texture: string; // png file with alpha
  /** placement on the layer canvas: center position in canvas px, scale, rotation in degrees */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  sourceBox?: Box; // where it came from in the source image
  quality?: MaskQuality;
  color?: string; // fill for generated geometry (bridges / frames)
}

/** canvas: the layered composition. */
export interface CanvasLayer {
  id: string;
  name: string;
  depth: number;
  frame: boolean;
  frameWidthMm: number;
  visible: boolean;
  elementIds: string[];
}
export interface Canvas {
  width: number;
  height: number;
  layers: CanvasLayer[];
}

/** material_settings: material and thickness set the fabrication limits. */
export interface MaterialSettings {
  material: string;
  thicknessMm: number;
  minFeatureMm: number;
  sheetWidthMm: number;
  layerGapMm: number;
}

/** constraint_issues */
export interface ConstraintIssue {
  id: string;
  type: 'floating' | 'thin';
  layerId: string;
  elementIds: string[];
  box: Box; // canvas px
  areaMm2: number;
  /** for floating parts: nearest points between the part and the main piece (canvas px) */
  from?: [number, number];
  to?: [number, number];
  detail: string;
}

/** constraint_report */
export interface ConstraintReport {
  report: string;
  options: { id: string; label: string; description: string; issueIds: string[] }[];
}

/** fix_call */
export interface FixCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface PrepareTurn {
  role: 'agent' | 'user' | 'tool';
  text: string;
  fixCall?: FixCall;
}

export interface DecomposeLogEntry {
  t: number;
  step: string;
  detail?: string;
}

export interface GrabState {
  request: string;
  candidates: string[];
  chosen?: string;
  occlusion?: 'occluded' | 'complete';
  isolated?: string;
  elementId?: string;
}

/** Everything derived from one source image version ("each version can be analyzed independently"). */
export interface Workspace {
  sourceId: string;
  layerPlan?: LayerPlan;
  layerPlanHistory: LayerPlan[];
  planChat: { role: 'user' | 'model'; text: string }[];
  confirmedLayers?: LayerPlan;
  layerItems?: LayerItem[];
  style?: string;
  workImages: string[];
  decomposeLog: DecomposeLogEntry[];
  decomposeStatus: 'idle' | 'running' | 'done' | 'error';
  elements: Record<string, Element>;
  canvas?: Canvas;
  canvasHistory: { canvas: Canvas; elements: Record<string, Element> }[];
  material: MaterialSettings;
  prepare: {
    issues: ConstraintIssue[];
    report?: ConstraintReport;
    chat: PrepareTurn[];
    checkedAt?: number;
  };
  grab?: GrabState;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  prompt?: string;
  imageCandidates: string[];
  sourceVersions: SourceVersion[];
  activeSourceId?: string;
  workspaces: Record<string, Workspace>;
}

export interface Job {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  log: string[];
  error?: string;
  result?: unknown;
}

export const MATERIAL_PRESETS: Record<string, Omit<MaterialSettings, 'sheetWidthMm' | 'layerGapMm'>> = {
  paper: { material: 'paper', thicknessMm: 0.3, minFeatureMm: 1.0 },
  cardstock: { material: 'cardstock', thicknessMm: 0.6, minFeatureMm: 1.5 },
  plywood: { material: 'plywood', thicknessMm: 3, minFeatureMm: 2.5 },
  acrylic: { material: 'acrylic', thicknessMm: 3, minFeatureMm: 2.0 },
};
