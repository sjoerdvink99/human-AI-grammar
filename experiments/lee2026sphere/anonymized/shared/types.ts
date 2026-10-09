// Types named after the design identifiers (version suffix dropped).
// See PLAN.md for the inferred meaning of every rN.

/** Fixed semantic axes that make up the request embedding (r4) and asset vectors. */
export const AXES = [
  'seating', 'sleeping', 'storage', 'surface', 'lighting', 'plants', 'electronics', 'cooking',
  'bathing', 'work', 'relaxation', 'decor', 'outdoor', 'children', 'dining', 'reading',
] as const;
export type Axis = (typeof AXES)[number];

export type Placement = 'wall' | 'corner' | 'center' | 'free';

export interface CompositeMember {
  assetId: string;
  dx: number; // offset from group center, cm
  dy: number;
  rot: number;
  color?: string;
}

/** One entry of the asset library (r2) and of new asset records (r28). */
export interface Asset {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  vector: number[]; // length AXES.length, 0..1
  w: number; // footprint, cm
  h: number;
  shape: 'rect' | 'circle';
  color: string;
  placement: Placement;
  source: 'seed' | 'learned';
  composite?: { members: CompositeMember[] };
  thumbnail?: string; // r29 SVG markup
}

/** r2: artifact record */
export interface Library {
  version: number;
  assets: Asset[];
}

/** r3: artifact record — learned reliability model used by model_5 / tool_3 select. */
export interface Reliability {
  version: number;
  prior: number;
  learningRate: number;
  weights: Record<string, number>; // assetId -> 0..1
  history: { at: string; sceneId: string; updates: Record<string, { from: number; to: number; score: number }> }[];
}

/** r4: artifact numeric */
export type RequestEmbedding = number[];

/** r5 / r7 / r9: selection record */
export interface Candidate { assetId: string; similarity: number; members?: string[] }
export interface RerankRow { assetId: string; relevance: number; reason: string } // r6 row
export interface Shortlisted { assetId: string; similarity: number; relevance: number; members?: string[] } // r7 item
export interface SlotRow { slot: string; assetId: string; count: number; confidence: number } // r8 row
export interface ChosenAsset { slot: string; assetId: string; count: number; score: number } // r9 item

/** r10: instruction record — placement request */
export interface PlacementRequest {
  instances: { instanceId: string; assetId: string; slot: string; w: number; h: number; placement: Placement; composite?: CompositeMember[] }[];
}

/** r11: artifact record — the scene */
export interface Scene {
  id: string;
  title: string;
  request: string;
  room: { width: number; depth: number };
  createdAt: string;
}

/** r12: instruction record — layout spec */
export interface LayoutSpec {
  room: { width: number; depth: number };
  instances: PlacementRequest['instances'];
  hints: { kind: 'near' | 'against-wall' | 'corner' | 'center'; a: string; b?: string }[];
  seed: number;
}

/** r13 / r24 / r25 / r26: artifact graph */
export interface GraphNode { id: string; label: string; data?: Record<string, unknown> }
export interface GraphEdge { source: string; target: string; relation: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

/** r14 item: artifact spatial */
export interface PlacedObject {
  id: string;
  assetId: string;
  name: string;
  x: number; // center, cm
  y: number;
  w: number;
  h: number;
  rot: number;
  color: string;
  shape: 'rect' | 'circle';
}
export type Layout = PlacedObject[];

/** r15: artifact record — view state and edit log */
export interface SceneView {
  scale: number; // px per cm
  showGrid: boolean;
  editLog: { at: string; utterance: string; ops: EditOp[] }[];
}

/** r16: selection spatial */
export interface SpatialSelection {
  objectIds: string[];
  region?: { x: number; y: number; w: number; h: number };
}

/** r19: instruction record */
export interface ComposedCommand {
  utterance: string;
  selection: { objectIds: string[]; objects: Pick<PlacedObject, 'id' | 'name' | 'x' | 'y' | 'w' | 'h' | 'rot' | 'color'>[]; region?: SpatialSelection['region'] };
  room: Scene['room'];
  objects: Pick<PlacedObject, 'id' | 'name' | 'x' | 'y' | 'w' | 'h' | 'rot'>[];
}

/** r20: instruction record */
export interface Intent {
  action: string;
  targets: string[];
  parameters: Record<string, unknown>;
  explanation: string;
}

/** r21 item: instruction record */
export type EditOp =
  | { op: 'move'; target: string; dx: number; dy: number }
  | { op: 'moveTo'; target: string; x: number; y: number }
  | { op: 'rotate'; target: string; degrees: number }
  | { op: 'scale'; target: string; factor: number }
  | { op: 'recolor'; target: string; color: string }
  | { op: 'delete'; target: string }
  | { op: 'duplicate'; target: string; dx: number; dy: number };

/** r22: artifact record */
export interface SceneSnapshot { scene: Scene; layout: Layout; view: SceneView }

/** r23 row */
export interface ObjectRow { id: string; assetId: string; name: string; x: number; y: number; w: number; h: number; rot: number; color: string }

/** r30 item */
export type Verdict = 'accept' | 'revise' | 'reject';
export interface Judgement { assetId: string; verdict: Verdict; reason: string }

/** r31 item */
export interface AssetScore { assetId: string; score: number }

export interface Trace { step: string; actor: string; output: unknown; ms: number }
