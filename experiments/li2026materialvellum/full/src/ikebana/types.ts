export type IkebanaKind = 'shin' | 'soe' | 'hikae' | 'flower' | 'leaf';

/** ikebana_elements: magnetic circles for the main flowers and leaves. */
export interface IkebanaElement { id: string; kind: IkebanaKind; x: number; y: number; r: number }

/** ikebana_canvas: the canvas for a flower arrangement, with a vase. */
export interface IkebanaCanvas { size: number; origin: [number, number]; vase: { x: number; y: number; w: number; h: number } }
export const ikebanaCanvas1: IkebanaCanvas = {
  size: 512,
  origin: [256, 400],
  vase: { x: 176, y: 400, w: 160, h: 70 },
};

export const KIND_RADIUS: Record<IkebanaKind, number> = { shin: 24, soe: 21, hikae: 18, flower: 14, leaf: 12 };
export const KIND_COLOR: Record<IkebanaKind, string> = {
  shin: '#c0392b', soe: '#d35400', hikae: '#8e44ad', flower: '#e84393', leaf: '#27ae60',
};
export const KIND_LABEL: Record<IkebanaKind, string> = {
  shin: 'Shin (heaven)', soe: 'Soe (human)', hikae: 'Hikae (earth)', flower: 'Flower', leaf: 'Leaf',
};
