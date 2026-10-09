import type { Point, ScribblePayload } from '../shared/api';

/** (ikebana_canvas: artifact spatial) — the surface with a vase whose mouth is the anchor point */
export interface IkebanaCanvas {
  width: number;
  height: number;
  mouth: Point;
  /** vase outline polygon */
  vase: Point[];
}

export const ELEMENT_KINDS = ['branch', 'flower', 'leaf', 'grass'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** (ikebana_elements: instruction spatial)* */
export interface IkebanaElement {
  id: string;
  kind: ElementKind;
  /** stroke for branch/leaf/grass; [center] for flower */
  points: Point[];
  /** flower radius in px; unused for strokes */
  size: number;
}

/** (scribble_map: artifact visual) */
export interface ScribbleMap extends ScribblePayload {
  pngDataUrl: string;
}

/** (ikebana_image: artifact visual) */
export interface GeneratedImage {
  version: number;
  svg: string;
}
