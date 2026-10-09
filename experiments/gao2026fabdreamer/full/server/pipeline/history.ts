// canvas_1 → canvas_2: earlier canvas versions are kept so the user can revert.
import type { Workspace } from '../../shared/types.js';

export const MAX_HISTORY = 40;

export function pushCanvasHistory(ws: Workspace) {
  if (!ws.canvas) return;
  ws.canvasHistory.push(structuredClone({ canvas: ws.canvas, elements: ws.elements }));
  if (ws.canvasHistory.length > MAX_HISTORY) ws.canvasHistory.shift();
}

export function undoCanvas(ws: Workspace) {
  const prev = ws.canvasHistory.pop();
  if (!prev) return false;
  ws.canvas = prev.canvas;
  ws.elements = prev.elements;
  return true;
}
