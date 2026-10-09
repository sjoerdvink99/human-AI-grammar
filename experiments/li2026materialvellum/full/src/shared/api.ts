// Payload types shared by the frontend and the backend.

/** depth_map: sent to model_1 as an image is downsampled to a numeric grid. */
export interface UrbanRenderReq {
  depthGrid: number[][]; // rows of 0..9, 0 = ground, 9 = tallest
  size: number;
}
export interface SvgRes { svg: string }

export interface InpaintMask { id: string; x: number; y: number; w: number; h: number }
export interface UrbanInpaintReq {
  render: string; // render_1 svg
  masks: InpaintMask[]; // inpainting_masks_1
  prompts: string[]; // function_prompts_1 (aligned with masks)
  size: number;
}
export interface UrbanInpaintRes { patches: { id: string; svg: string }[] }

export interface ScribbleMap {
  size: number;
  strokes: { kind: string; points: [number, number][] }[];
  circles: { kind: string; cx: number; cy: number; r: number }[];
}
export interface IkebanaReq { scribble: ScribbleMap; prompt: string }

export type ElementRole = 'title' | 'subtitle' | 'body' | 'image' | 'decoration';
export const ELEMENT_ROLES: ElementRole[] = ['title', 'subtitle', 'body', 'image', 'decoration'];

export interface ElementSpec {
  clusterId: string;
  role: ElementRole;
  x: number; y: number; w: number; h: number; // poster px
  size: number; // 0..1 relative area
  weight: number; // 0..1 density → visual weight
  request: string; // content request
}
export interface PosterTextReq { theme: string; specs: ElementSpec[] }
export interface TextElement { clusterId: string; text: string }
export interface PosterTextRes { texts: TextElement[] }
export interface PosterImageReq { specs: ElementSpec[]; texts: TextElement[] }
export interface ImageElement { clusterId: string; svg: string }
export interface PosterImageRes { images: ImageElement[] }
