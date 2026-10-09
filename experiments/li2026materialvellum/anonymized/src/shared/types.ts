// Typed representations from design.json. Names follow the design identifiers (r1 … r24).

export const CANVAS_W = 800;
export const CANVAS_H = 600;

export type Point = { x: number; y: number };

/** Spatial artifact: a drawing surface (r1 groundPlan, r11 sketchCanvas, r17 collageCanvas). */
export interface CanvasSpec {
  width: number;
  height: number;
  grid?: number; // metres per grid cell for the ground plan
}

/** Raw freehand stroke (instruction spatial, version _1). */
export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  width: number;
  /** Edit intent for r8 edit strokes; unused elsewhere. */
  intent?: EditIntent;
  recolorTo?: string;
}

export type ShapeKind = "line" | "rectangle" | "ellipse" | "triangle" | "polygon" | "freeform";

/** Beautified stroke (instruction spatial, version _2), produced by tool_1. */
export interface Shape {
  id: string;
  kind: ShapeKind;
  points: Point[]; // cleaned outline / polyline
  closed: boolean;
  color: string;
  width: number;
  bbox: BBox;
  intent?: EditIntent;
  recolorTo?: string;
}

export interface BBox { x: number; y: number; w: number; h: number }

/** r3 layout: composed ground-plan footprints (artifact spatial). Units: metres. */
export interface Layout {
  footprints: { id: string; polygon: Point[]; height: number; color: string }[];
  extent: { w: number; d: number };
}

export type Vec3 = { x: number; y: number; z: number };

/** r5 camera (instruction spatial). Angles in degrees. */
export interface Camera {
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
  target: Vec3;
}

/** r4 scene (artifact spatial): 3D prisms + ground + current camera. */
export interface Scene3D {
  prisms: { id: string; base: Vec3[]; height: number; color: string }[];
  ground: { w: number; d: number };
  /** null in r4_1 (camera not yet applied); set in r4_2. */
  camera: Camera | null;
  version: number;
}

/** SVG markup string — the `visual` medium in this implementation. */
export type SvgImage = string;

export type EditIntent = "remove" | "add-detail" | "brighten" | "darken" | "recolor" | "replace-sky";

export const EDIT_INTENTS: { id: EditIntent; label: string; color: string }[] = [
  { id: "remove", label: "Remove", color: "#e5484d" },
  { id: "add-detail", label: "Add detail", color: "#30a46c" },
  { id: "brighten", label: "Brighten", color: "#f5d90a" },
  { id: "darken", label: "Darken", color: "#6e56cf" },
  { id: "recolor", label: "Recolor", color: "#0091ff" },
  { id: "replace-sky", label: "Make it sky", color: "#68ddfd" },
];

/** r9 selection spatial. */
export interface RegionSelection {
  id: string;
  index: number;
  polygon: Point[];
  bbox: BBox;
}

/** r18 boxes (instruction spatial). */
export interface Box extends BBox { id: string }

/** r19 voice note (instruction audio). */
export interface VoiceNote {
  boxId: string;
  audioUrl: string | null; // object URL of the recording
  transcript: string;
}

/** r20 label categorical — fixed category set. */
export const CATEGORIES = [
  "person", "animal", "tree", "flower", "house", "building", "car", "boat",
  "mountain", "sun", "moon", "cloud", "water", "table", "chair", "food",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Label { boxId: string; category: Category | null; transcript: string }

/** r21 instruction record. */
export interface ItemRecord {
  boxId: string;
  label: Category;
  region: BBox;
  position: string; // coarse words ("upper left") derived from region
  globalPrompt: string;
}

/** r22 artifact language. */
export interface ItemDescription { boxId: string; text: string }

/** r23 artifact visual. */
export interface ItemImage { boxId: string; svg: SvgImage }
