// Typed representations of the System X design. Names follow the design identifiers.

export type Wall = 'north' | 'south' | 'east' | 'west';

/** Room geometry. x runs west→east in [0,width], z runs north→south in [0,depth]. */
export interface Room {
  roomType: string;
  width: number;
  depth: number;
  height: number;
  windows: { wall: Wall; offset: number; width: number }[];
  door: { wall: Wall; offset: number; width: number };
}

export interface SceneObject {
  id: string;
  type: string; // catalog type
  label: string;
  x: number; // centre
  z: number;
  rotation: number; // degrees, 0 = front faces +z (south)
  w: number; // footprint along local x
  d: number; // footprint along local z
  h: number;
  color: string;
}

export interface SceneRelation {
  subject: string;
  relation: string;
  object: string;
}

/** scene_graph: artifact graph */
export interface SceneGraph {
  room: Room;
  objects: SceneObject[];
  relations: SceneRelation[];
}

/** spatial_constraints / generation constraints: rules a layout generator can use */
export type ConstraintKind =
  | 'near'
  | 'far_from'
  | 'facing'
  | 'against_wall'
  | 'near_window'
  | 'in_corner'
  | 'centered'
  | 'away_from_door';

export interface SpatialConstraint {
  kind: ConstraintKind;
  subject: string; // object type
  object?: string; // object type (for near / far_from / facing)
  weight: number;
  source: 'default' | 'retrieved' | 'request';
  statement?: string;
}

/** room_constraints: instruction record */
export interface RoomConstraints {
  room: Room;
  objectTypes: string[];
  notes: string[];
}

/** generation_constraints: instruction record */
export interface GenerationConstraints {
  room: Room;
  objectTypes: string[];
  constraints: SpatialConstraint[];
  seed: number;
}

export interface MemoryAffordance {
  id: string;
  sceneId: string;
  statement: string;
  constraint: SpatialConstraint;
  key: number[]; // reranker key vector
}

export interface MemoryScene {
  id: string;
  request: string;
  key: number[]; // embedding of the request that produced the scene
  room: Room;
  objectTypes: string[];
  createdAt: string;
  affordances: MemoryAffordance[];
}

/** preference_memory: artifact record */
export interface PreferenceMemory {
  version: number;
  scenes: MemoryScene[];
}

export interface LoraReranker {
  dim: number;
  rank: number;
  alpha: number;
  A: number[][]; // dim x rank
  B: number[][]; // dim x rank
}

/** retrieval_policy: artifact record */
export interface RetrievalPolicy {
  version: number;
  temperature: number;
  nCandidates: number;
  kScenes: number;
  kAffordances: number;
  learningRate: number;
  baseline: number;
  sceneReranker: LoraReranker;
  affordanceReranker: LoraReranker;
  history: { version: number; at: string; meanReward: number; sessionId: string }[];
}

export interface ScoredSceneRow {
  sceneId: string;
  request: string;
  cosine: number;
  score: number;
  prob: number;
}

export interface ScoredAffordanceRow {
  affordanceId: string;
  sceneId: string;
  statement: string;
  score: number;
  prob: number;
}

/** retrieval_trace: artifact record */
export interface RetrievalTrace {
  sessionId: string;
  request: string;
  policyVersion: number;
  memoryVersion: number;
  queryEmbedding: number[];
  scenes: { candidates: { id: string; key: number[] }[]; chosen: string[] };
  affordances: {
    query: number[];
    candidates: { id: string; key: number[]; statement: string; sceneId: string }[];
    chosen: string[];
  };
}

export type Target =
  | { kind: 'object'; id: string; label: string }
  | { kind: 'position'; x: number; z: number };

export type EditSubtask =
  | { op: 'add'; type: string; x?: number; z?: number; near?: string; color?: string }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; x: number; z: number }
  | { op: 'rotate'; id: string; degrees: number; absolute?: boolean }
  | { op: 'resize'; id: string; factor: number }
  | { op: 'recolor'; id: string; color: string };

/** interaction_state: instruction record */
export interface InteractionState {
  transcript: string;
  targets: Target[];
  scene: {
    room: Pick<Room, 'roomType' | 'width' | 'depth'>;
    objects: { id: string; type: string; label: string; x: number; z: number; rotation: number }[];
  };
}

/** resolved_instruction: instruction record */
export interface ResolvedInstruction {
  command: string;
  references: { phrase: string; resolvedTo: string }[];
}

export interface InteractionLogEntry {
  t: string;
  transcript: string;
  targets: Target[];
  resolved?: ResolvedInstruction;
  subtasks: EditSubtask[];
  results: string[];
}

/** interaction_log: artifact record */
export interface InteractionLog {
  sessionId: string;
  entries: InteractionLogEntry[];
}

export type RealizationSignal = 'realized' | 'partial' | 'not_realized';

/** Generic node-link structure for graph-medium representations (functional_zones, geometric_context). */
export interface GraphRep {
  nodes: { id: string; kind: 'room' | 'zone' | 'object'; label: string; x?: number; z?: number }[];
  edges: { source: string; target: string; relation: string; value?: number }[];
}

/** object_features: one row per object. */
export interface ObjectFeatureRow {
  id: string; type: string; functions: string; w: number; d: number; h: number; x: number; z: number; rotation: number;
  nearestWall: string; wallDist: number; windowDist: number; doorDist: number; editedByUser: boolean; addedByUser: boolean;
}

/** hierarchical_context: room → zones → objects. */
export interface HierarchicalContext {
  room: { summary: string; zones: { name: string; summary: string; objects: { id: string; role: string }[] }[] };
}

/** session_payload: artifact record */
export interface SessionPayload {
  sessionId: string;
  request: string;
  scene: SceneGraph;
  interactionLog: InteractionLog;
}
