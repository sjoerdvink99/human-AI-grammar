// Typed application state named after the design's identifiers (version suffix dropped).
// See PLAN.md for the full identifier → type table.

export type Svg = string;

export interface Dim { w: number; h: number; d: number } // millimetres
export interface Vec3 { x: number; y: number; z: number } // millimetres, y up, ground at y = 0

/** A versioned visual artifact (r3, r10). */
export interface ImageVersion { id: string; svg: Svg; note: string; createdAt: number }

/** r5 — design spec (artifact record). */
export interface Spec {
  name: string;
  summary: string;
  category: string;
  dimensions: Dim;
  materials: string[];
  parts: { name: string; description: string; material: string; count: number }[];
  style: string;
}

/** r7 — which spec parts to build (instruction record). */
export interface PartSelection { parts: Spec["parts"]; dimensions: Dim; objectName: string }

export type Shape = "box" | "cylinder";
export type ZHint = "front" | "center" | "back";

/** r8 — one physical piece (artifact record). */
export interface PartRecord {
  id: string;
  name: string;
  shape: Shape;
  material: string;
  size: Dim;
  zHint: ZHint;
  attachTo: string | null;
  notes: string;
}

/** 2D box in a 512×512 image (r13, r16, r18, r25). */
export interface Box2D { partId: string; x: number; y: number; w: number; h: number; confidence: number }

/** r11, r19, r26, r32, r37 — a 3D part (artifact spatial). Position is the centre. */
export interface Part3D {
  id: string;
  name: string;
  shape: Shape | "profile";
  size: Dim;
  position: Vec3;
  rotationY: number; // degrees
  color: string;
  material: string;
  /** For shape "profile": silhouette extruded along profileAxis. */
  profileSvg?: Svg;
  profileAxis?: "z" | "x";
  /** Where this part sits in the reference image (r10 coords), used by P8. */
  imageBox?: Box2D;
  source: string;
}

/** r12 — grounding query (instruction record). */
export interface GroundingQuery { partId: string; query: string }

/** r15 — check of one 2D box (evaluation record). */
export interface BoxCheck { partId: string; pass: boolean; issues: string[]; maxOverlap: number; areaFraction: number }

/** r14 — critique of the extracted parts (instruction language + stop flag). */
export interface Critique { ok: boolean; instruction: string }

/** r27 — assembly (artifact spatial). */
export interface Assembly { parts: Part3D[] }

/** r38 — fabrication constraints (instruction record). */
export interface Constraints {
  method: "laser-cut sheet" | "cnc sheet" | "3d print" | "woodworking";
  material: string;
  sheetThickness: number;
  minThickness: number;
  maxW: number;
  maxH: number;
  maxD: number;
}

/** r39 — one fabrication check (evaluation record). */
export interface FabCheck {
  id: string;
  kind: "bounds" | "floating" | "overlap" | "thickness" | "sheet" | "stability" | "ground";
  severity: "error" | "warning" | "info";
  partIds: string[];
  message: string;
  value?: number;
}

/** r40 — advisor explanation (evaluation language with selectable suggestions). */
export interface Advice { summary: string; suggestions: { id: string; title: string; rationale: string }[] }

/** r42 — edit ops (instruction record), executed by tool_3. */
export interface EditOp {
  op: "move" | "resize" | "rotate" | "delete" | "add";
  partId?: string;
  position?: Vec3;
  size?: Dim;
  rotationY?: number;
  name?: string;
  shape?: Shape;
  material?: string;
}

/** r35 — planned part change from a language edit (instruction record). */
export interface PlannedPart {
  key: string;
  action: "add" | "replace";
  replacesId: string | null;
  name: string;
  shape: Shape;
  material: string;
  size: Dim;
  placement: string;
  /** Geometry of the part the placement refers to, resolved from r27 during validation. */
  anchor: { id: string; name: string; position: Vec3; size: Dim } | null;
}

/** r36 — 3D placement box (selection spatial). */
export interface Placement3D { key: string; position: Vec3; size: Dim }

/** r23 — part image judgement (evaluation categorical). */
export type PartImageVerdict = "usable" | "needs_cleanup" | "unusable";

/** r45 — export format (instruction categorical). */
export type ExportFormat = "openscad" | "drawings" | "full";

/** r46 — export bundle (artifact record). */
export interface ExportBundle {
  format: ExportFormat;
  createdAt: string;
  name: string;
  bom: { id: string; name: string; material: string; w: number; h: number; d: number }[];
  files: { name: string; mime: string; content: string }[];
}
