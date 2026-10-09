// tool_3 execute: geometry/SVG editing tools invoked by the agent's fix_call (process 10).
import type { FixCall, Project, Workspace } from '../../shared/types.js';
import { filePath } from '../store.js';
import { pushCanvasHistory } from '../pipeline/history.js';
import { dilate, loadMask, loadRGBA, openMask, removeSmall, pushPullFill, maskBox, padBox, cropMask, cutout, type RGBA } from './raster.js';
import { mmPerPx, shapeElement } from './layerRender.js';
import { updateElementGeometry } from './vectorize.js';

/** Tool descriptions given to model_4 (the language model with tool calling). */
export const FIX_TOOLS = [
  {
    tool: 'add_bridge',
    description: 'Connect a floating piece to the main piece of its layer with a straight strip of material.',
    args: '{ layerId: string, from: [x, y], to: [x, y], widthMm?: number }  (canvas px points; use the issue\'s from/to)',
  },
  { tool: 'add_frame', description: 'Add a border frame to a layer so all pieces touching it are held together.', args: '{ layerId: string, widthMm?: number }' },
  { tool: 'thicken_element', description: 'Grow an element outward so thin features reach the minimum width.', args: '{ elementId: string, amountMm: number }' },
  { tool: 'remove_thin_parts', description: 'Remove features of an element that are thinner than the minimum feature width.', args: '{ elementId: string }' },
  { tool: 'move_element_to_layer', description: 'Move an element to another layer (e.g. onto a layer where it touches other material).', args: '{ elementId: string, layerId: string }' },
  { tool: 'delete_element', description: 'Delete an element from the design.', args: '{ elementId: string }' },
  { tool: 'set_min_feature', description: 'Change the minimum feature width (only if the user says the material allows it).', args: '{ minFeatureMm: number }' },
];

export async function executeFix(p: Project, ws: Workspace, call: FixCall): Promise<string> {
  const a = call.args as any;
  const c = ws.canvas!;
  const mm = mmPerPx(ws);
  const layerOf = (id: string) => {
    const l = c.layers.find((x) => x.id === id);
    if (!l) throw new Error(`unknown layer ${id}`);
    return l;
  };
  const elOf = (id: string) => {
    const e = ws.elements[id];
    if (!e) throw new Error(`unknown element ${id}`);
    return e;
  };
  switch (call.tool) {
    case 'add_bridge': {
      const layer = layerOf(a.layerId);
      const from = a.from as [number, number];
      const to = a.to as [number, number];
      if (!Array.isArray(from) || !Array.isArray(to)) throw new Error('add_bridge needs from/to points');
      const wPx = Math.max(ws.material.minFeatureMm * 1.5, Number(a.widthMm) || 0) / mm;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const ext = wPx; // overlap into both pieces
      const nx = -uy * (wPx / 2);
      const ny = ux * (wPx / 2);
      const p0: [number, number] = [from[0] - ux * ext, from[1] - uy * ext];
      const p1: [number, number] = [to[0] + ux * ext, to[1] + uy * ext];
      const poly: [number, number][] = [
        [p0[0] + nx, p0[1] + ny],
        [p1[0] + nx, p1[1] + ny],
        [p1[0] - nx, p1[1] - ny],
        [p0[0] - nx, p0[1] - ny],
      ];
      pushCanvasHistory(ws);
      const el = await shapeElement(p.id, 'Bridge', layer.id, 'bridge', poly, '#b59a7a');
      ws.elements[el.id] = el;
      layer.elementIds.unshift(el.id);
      return `Added a ${(wPx * mm).toFixed(1)} mm bridge on layer "${layer.name}".`;
    }
    case 'add_frame': {
      const layer = layerOf(a.layerId);
      pushCanvasHistory(ws);
      layer.frame = true;
      layer.frameWidthMm = Math.max(ws.material.minFeatureMm * 2, Number(a.widthMm) || layer.frameWidthMm || 6);
      return `Added a ${layer.frameWidthMm} mm frame to layer "${layer.name}".`;
    }
    case 'thicken_element': {
      const e = elOf(a.elementId);
      const amountMm = Math.max(0.1, Number(a.amountMm) || ws.material.minFeatureMm / 2);
      const r = Math.max(1, Math.round(amountMm / mm / e.scale));
      const { mask } = await loadMask(filePath(p.id, e.mask));
      const tex = await loadRGBA(filePath(p.id, e.texture));
      // pad by r so the shape can grow
      const W = e.width + 2 * r;
      const H = e.height + 2 * r;
      const pm = new Uint8Array(W * H);
      const pt = Buffer.alloc(W * H * 4);
      for (let y = 0; y < e.height; y++)
        for (let x = 0; x < e.width; x++) {
          const si = y * e.width + x;
          const di = (y + r) * W + x + r;
          pm[di] = mask[si];
          for (let k = 0; k < 4; k++) pt[di * 4 + k] = tex.data[si * 4 + k];
        }
      const grown = dilate(pm, W, H, r);
      const hole = new Uint8Array(W * H);
      for (let i = 0; i < hole.length; i++) hole[i] = pm[i] ? 0 : 1;
      const filled = pushPullFill({ data: pt, width: W, height: H }, hole);
      for (let i = 0; i < hole.length; i++) filled.data[i * 4 + 3] = grown[i] ? 255 : 0;
      pushCanvasHistory(ws);
      ws.elements[e.id] = await updateElementGeometry(p.id, e, grown, filled);
      return `Thickened "${e.name}" by ${amountMm.toFixed(1)} mm.`;
    }
    case 'remove_thin_parts': {
      const e = elOf(a.elementId);
      const r = ws.material.minFeatureMm / mm / e.scale / 2;
      const { mask } = await loadMask(filePath(p.id, e.mask));
      const tex = await loadRGBA(filePath(p.id, e.texture));
      const opened = removeSmall(openMask(mask, e.width, e.height, r), e.width, e.height, 10);
      const b = maskBox(opened, e.width, e.height);
      if (!b) throw new Error(`removing thin parts would delete "${e.name}" entirely`);
      const box = padBox(b, 1, e.width, e.height);
      const local = cropMask(opened, e.width, box, e.height);
      const t: RGBA = cutout(tex, opened, box);
      pushCanvasHistory(ws);
      const next = await updateElementGeometry(p.id, e, local, t);
      // keep the remaining shape where it was
      const dx = (box[0] + box[2]) / 2 - e.width / 2;
      const dy = (box[1] + box[3]) / 2 - e.height / 2;
      const rot = (e.rotation * Math.PI) / 180;
      next.x = e.x + e.scale * (dx * Math.cos(rot) - dy * Math.sin(rot));
      next.y = e.y + e.scale * (dx * Math.sin(rot) + dy * Math.cos(rot));
      ws.elements[e.id] = next;
      return `Removed features thinner than ${ws.material.minFeatureMm} mm from "${e.name}".`;
    }
    case 'move_element_to_layer': {
      const e = elOf(a.elementId);
      const to = layerOf(a.layerId);
      pushCanvasHistory(ws);
      for (const l of c.layers) l.elementIds = l.elementIds.filter((id) => id !== e.id);
      to.elementIds.push(e.id);
      e.layerId = to.id;
      return `Moved "${e.name}" to layer "${to.name}".`;
    }
    case 'delete_element': {
      const e = elOf(a.elementId);
      pushCanvasHistory(ws);
      for (const l of c.layers) l.elementIds = l.elementIds.filter((id) => id !== e.id);
      delete ws.elements[e.id];
      return `Deleted "${e.name}".`;
    }
    case 'set_min_feature': {
      const v = Number(a.minFeatureMm);
      if (!(v > 0)) throw new Error('minFeatureMm must be positive');
      ws.material.minFeatureMm = v;
      return `Minimum feature width set to ${v} mm.`;
    }
    default:
      throw new Error(`unknown tool ${call.tool}`);
  }
}
