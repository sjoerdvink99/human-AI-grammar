/** Types shared by the browser and the model server. Names follow the design's identifiers. */

export interface Point { x: number; y: number }

// ---------- process 1 ----------
export interface DepthMapPayload {
  width: number;
  height: number;
  grid: number;
  /** grid*grid quantized depth levels 0 (ground) … 9 (tallest), row-major from the top-left */
  levels: number[];
  maxHeightM: number;
}
export interface InpaintMask { id: string; cx: number; cy: number; r: number }
export interface FunctionPrompt { maskId: string; text: string }

export interface GenerateRenderReq { depth_map: DepthMapPayload }
export interface InpaintRenderReq {
  render: { svg: string; width: number; height: number };
  inpainting_masks: InpaintMask[];
  function_prompts: FunctionPrompt[];
}
export interface SvgRes { svg: string }

// ---------- process 2 ----------
export interface ScribblePayload {
  width: number;
  height: number;
  /** black strokes on white: polylines with a pen thickness */
  strokes: { points: Point[]; thickness: number }[];
}
export interface GenerateIkebanaReq { scribble_map: ScribblePayload; ikebana_prompt: string }

// ---------- process 3 ----------
export const ELEMENT_ROLES = ['title', 'subtitle', 'body', 'date', 'caption', 'image'] as const;
export type ElementRoleValue = (typeof ELEMENT_ROLES)[number];
export const TEXT_ROLES: ElementRoleValue[] = ['title', 'subtitle', 'body', 'date', 'caption'];

export interface BBox { x: number; y: number; w: number; h: number }
export interface ElementSpec {
  id: string;
  role: ElementRoleValue;
  bbox: BBox;
  /** reading order, 1 = first */
  order: number;
  theme: string;
  /** for text roles: the most characters that fit the cluster */
  maxChars?: number;
}
export interface TextElement { id: string; text: string }
export interface ImageElement { id: string; svg: string }

export interface PosterTextReq { poster_theme: string; element_specs: ElementSpec[] }
export interface PosterTextRes { text_elements: TextElement[] }
export interface PosterImagesReq { element_specs: ElementSpec[]; text_elements: TextElement[] }
export interface PosterImagesRes { image_elements: ImageElement[] }
