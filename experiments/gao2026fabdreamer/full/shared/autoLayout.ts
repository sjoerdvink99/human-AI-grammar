// tool_2 compose: Auto Layout. Places extracted elements (segments) on their layer canvases.
// Elements with a source position keep it; elements without one (grabs) are placed in free space on their layer.
import type { Canvas, Element, LayerPlan } from './types.js';

export function autoLayout(plan: LayerPlan, elements: Record<string, Element>, width: number, height: number, prev?: Canvas): Canvas {
  const layers = plan.layers.map((l) => {
    const old = prev?.layers.find((p) => p.id === l.id);
    return {
      id: l.id,
      name: l.name,
      depth: l.depth,
      frame: old?.frame ?? false,
      frameWidthMm: old?.frameWidthMm ?? 6,
      visible: old?.visible ?? true,
      elementIds: [] as string[],
    };
  });
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const el of Object.values(elements)) {
    const layer = byId.get(el.layerId) ?? layers[0];
    el.layerId = layer.id;
    if (el.sourceBox) {
      el.x = (el.sourceBox[0] + el.sourceBox[2]) / 2;
      el.y = (el.sourceBox[1] + el.sourceBox[3]) / 2;
      el.scale = 1;
      el.rotation = 0;
    } else {
      // place unpositioned elements on a simple grid inside the canvas
      const n = layer.elementIds.length;
      el.scale = Math.min(1, (0.35 * Math.min(width, height)) / Math.max(el.width, el.height));
      el.x = width * (0.25 + 0.25 * (n % 3));
      el.y = height * (0.3 + 0.2 * (Math.floor(n / 3) % 3));
      el.rotation = 0;
    }
    layer.elementIds.push(el.id);
  }
  // draw order within a layer: background/frames first, then larger elements behind smaller ones
  for (const l of layers)
    l.elementIds.sort((a, b) => order(elements[a]) - order(elements[b]) || elements[b].width * elements[b].height - elements[a].width * elements[a].height);
  return { width, height, layers };
}

const order = (e: Element) => (e.origin === 'background' ? 0 : e.origin === 'frame' ? 1 : 2);
