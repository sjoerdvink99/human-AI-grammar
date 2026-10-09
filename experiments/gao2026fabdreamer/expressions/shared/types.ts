// Shared types. Names follow the identifiers in design.json (without version suffix).

export const IMAGE_SIZE = 512;

/** artifact visual: an image produced by model_2 (as SVG) and rasterized by a tool. */
export interface ImageArtifact {
  id: string;
  svg: string;
  /** data:image/png;base64,... */
  png: string;
  note?: string;
  createdAt: number;
}

/** layer_plan: artifact record */
export interface PlannedLayer {
  id: string;
  name: string;
  description: string;
  /** 0 = back-most */
  depth: number;
  elements: string[];
}
export interface LayerPlan {
  layers: PlannedLayer[];
  rationale: string;
  /** the layer_change that produced this version, if any */
  change?: string;
}

/** confirmed_layers: instruction record */
export interface ConfirmedLayers {
  layerIds: string[];
}

/** layer_items: artifact record* */
export interface LayerItem {
  id: string;
  layerId: string;
  name: string;
  description: string;
  color: string;
}

/** detection_prompts / part_prompts: instruction record* */
export interface DetectionPrompt {
  itemId: string;
  label: string;
  prompt: string;
}

/** mask_quality: evaluation record* */
export interface MaskQuality {
  itemId: string;
  label: string;
  areaFraction: number;
  components: number;
  largestComponentShare: number;
  ok: boolean;
  reasons: string[];
}

export type SegmentSource = 'detected' | 'refined' | 'fallback' | 'background' | 'grab' | 'repaired' | 'split';

/** segments: artifact spatial* — a cuttable shape. Geometry in 512-px canvas units. */
export interface Segment {
  id: string;
  label: string;
  itemId?: string;
  layerId: string;
  color: string;
  bbox: { x: number; y: number; w: number; h: number };
  /** SVG path data (absolute coords before offset), fill-rule evenodd */
  path: string;
  dx: number;
  dy: number;
  source: SegmentSource;
  area: number;
}

/** server-side segment keeps the mask; it is stripped before sending to the client */
export interface StoredSegment extends Segment {
  /** base64 of bbox.w*bbox.h bytes (0/1) */
  mask: string;
}

export interface CanvasLayer {
  id: string;
  name: string;
  /** 0 = back-most */
  depth: number;
  visible: boolean;
}

/** canvas: artifact spatial */
export interface Canvas<S extends Segment = Segment> {
  version: number;
  width: number;
  height: number;
  layers: CanvasLayer[];
  segments: S[];
  note?: string;
}

/** material_settings: instruction record */
export interface MaterialSettings {
  material: 'cardstock' | 'plywood' | 'acrylic' | 'mdf' | 'felt';
  thicknessMm: number;
  artworkWidthMm: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  minFeatureMm: number;
  minPartAreaMm2: number;
  maxLayers: number;
}

export const DEFAULT_MATERIAL: MaterialSettings = {
  material: 'cardstock',
  thicknessMm: 1.5,
  artworkWidthMm: 200,
  sheetWidthMm: 300,
  sheetHeightMm: 300,
  minFeatureMm: 1.5,
  minPartAreaMm2: 6,
  maxLayers: 6,
};

export type IssueType = 'thin_feature' | 'small_fragments' | 'unsupported' | 'out_of_bounds' | 'too_many_layers' | 'sheet_overflow';

export interface FixOption {
  id: string;
  label: string;
  tool: FixToolName;
}

/** constraint_issues: evaluation record* */
export interface ConstraintIssue {
  id: string;
  type: IssueType;
  severity: 'error' | 'warning';
  layerId?: string;
  segmentId?: string;
  message: string;
  measured: number;
  limit: number;
  options: FixOption[];
}

export type FixToolName =
  | 'thicken'
  | 'removeThinParts'
  | 'removeSmallFragments'
  | 'deleteSegment'
  | 'moveToLayer'
  | 'mergeLayers'
  | 'clipToFrame'
  | 'scaleSegment';

/** resolution: instruction record */
export interface Resolution {
  issueId: string;
  optionId: string;
}

/** fix_call: instruction record */
export interface FixCall {
  tool: FixToolName;
  args: Record<string, string | number>;
  explanation?: string;
}

export type Occlusion = 'complete' | 'occluded' | 'cropped';

export interface GrabState {
  request?: string;
  candidates: ImageArtifact[];
  image?: ImageArtifact;
  occlusion?: Occlusion;
  occlusionReason?: string;
  isolated?: ImageArtifact;
  /** grab_element: artifact spatial */
  element?: Segment;
}

export interface BuildRound {
  layerId: string;
  layerName: string;
  detectionPrompts: DetectionPrompt[];
  maskQuality: MaskQuality[];
  fallbackUsed: string[];
  fillPrompt?: string;
  workImageBefore: string; // image id
  workImageAfter?: string;
  segmentIds: string[];
}

export interface ProjectState {
  prompt?: string;
  imageCandidates: ImageArtifact[];
  /** versions of source_image; last is current */
  sourceImages: ImageArtifact[];
  imageUpdates: string[];
  /** versions of layer_plan; last is current */
  layerPlans: LayerPlan[];
  confirmedLayers?: ConfirmedLayers;
  layerItems: LayerItem[];
  style?: string;
  /** versions of work_image across peel rounds */
  workImages: ImageArtifact[];
  rounds: BuildRound[];
  grab: GrabState;
  grabbedElements: Segment[];
  canvas?: Canvas;
  canvasVersions: number;
  materialSettings: MaterialSettings;
  constraintIssues: ConstraintIssue[];
  constraintReport?: string;
  lastFixCall?: FixCall;
}

export interface JobStep {
  step: string; // grammar label, e.g. "[model_1 extract] → layer_items"
  status: 'running' | 'done' | 'error' | 'skipped';
  detail?: string;
  at: number;
}

export interface Job {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  steps: JobStep[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
