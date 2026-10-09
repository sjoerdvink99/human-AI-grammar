// Processes 1, 2, 3, 6, 7 (human modify), 8, 9.
import type { Canvas, StoredSegment } from '../shared/types.ts';
import * as ops from './ops.ts';
import { scaleMask, withMask, stripMask, area, decodeMask, emptyMask, intersect, maskToSegment, polygonsToMask, W, H, type Mask } from './mask.ts';
import { cropSvg, foregroundMask, meanColor, normalizeSvg, renderPng, toImageArtifact } from './svg.ts';
import { commitCanvas, currentPlan, currentSource, state, type JobCtx } from './store.ts';
import { newId } from './util.ts';

// ---------- Process 1 ----------
export async function p1Generate(ctx: JobCtx, prompt: string) {
  state.prompt = prompt;
  state.imageCandidates = [];
  await ctx.step('P1 [model_2 generate]~ prompt_1 → image_candidates_1* (×3)', async () => {
    const results = await Promise.allSettled([0, 1, 2].map((v) => ops.generateImage(prompt, v).then((svg) => toImageArtifact(svg, `candidate ${v + 1}`))));
    state.imageCandidates = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!state.imageCandidates.length) throw new Error('All generations failed: ' + results.map((r) => (r.status === 'rejected' ? String(r.reason) : '')).join(' | '));
    return state.imageCandidates;
  }, (c) => `${c.length} candidates`);
}

/** P1 [human select] image_candidates → source_image. Starting from a new source resets downstream work. */
export function p1Select(id: string) {
  const img = state.imageCandidates.find((c) => c.id === id);
  if (!img) throw new Error('unknown candidate');
  state.sourceImages = [img];
  state.imageUpdates = [];
  state.layerPlans = [];
  state.confirmedLayers = undefined;
  state.layerItems = [];
  state.style = undefined;
  state.workImages = [];
  state.rounds = [];
  state.segments = [];
  state.canvas = undefined;
  state.canvasHistory = [];
  state.constraintIssues = [];
  state.constraintReport = undefined;
}

// ---------- Process 2 ----------
export async function p2Modify(ctx: JobCtx, update: string) {
  const src = currentSource();
  if (!src) throw new Error('No source image');
  ctx.note('P2 [human specify] → image_update_1', update);
  const next = await ctx.step('P2 [model_2 modify]~ source_image_1 + image_update_1 → source_image_2', async () => toImageArtifact(await ops.modifyImage(src.svg, update), update));
  state.sourceImages.push(next);
  state.imageUpdates.push(update);
}

export function p2Revert(id: string) {
  const img = state.sourceImages.find((s) => s.id === id);
  if (!img) throw new Error('unknown version');
  state.sourceImages.push({ ...img, id: newId('img'), note: `reverted to: ${img.note ?? 'earlier version'}`, createdAt: Date.now() });
}

// ---------- Process 3 ----------
export async function p3Generate(ctx: JobCtx) {
  const src = currentSource();
  if (!src) throw new Error('No source image');
  const plan = await ctx.step('P3 [model_1 generate]~ source_image_1 → layer_plan_1', () => ops.generateLayerPlan(src.svg, src.png), (p) => p.layers.map((l) => l.name).join(' / '));
  state.layerPlans = [plan];
}

export async function p3Modify(ctx: JobCtx, change: string) {
  const src = currentSource();
  const plan = currentPlan();
  if (!src || !plan) throw new Error('No layer plan yet');
  ctx.note('P3 [human specify] → layer_change_1', change);
  const next = await ctx.step('P3 [model_1 modify]~ → layer_plan_1 (revised)', () => ops.modifyLayerPlan(src.svg, src.png, plan, change), (p) => p.layers.map((l) => l.name).join(' / '));
  state.layerPlans.push(next);
}

// ---------- Process 6 ----------
export async function p6Generate(ctx: JobCtx, request: string) {
  state.grab = { request, candidates: [] };
  await ctx.step('P6 [model_2 generate]~ grab_request_1 → grab_candidates_1* (×3)', async () => {
    const results = await Promise.allSettled([0, 1, 2].map((v) => ops.generateGrabCandidate(request, v).then((svg) => toImageArtifact(svg, `grab candidate ${v + 1}`))));
    state.grab.candidates = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!state.grab.candidates.length) throw new Error('All grab generations failed');
    return state.grab.candidates;
  }, (c) => `${c.length} candidates`);
}

export async function p6Select(ctx: JobCtx, id: string) {
  const img = state.grab.candidates.find((c) => c.id === id);
  if (!img) throw new Error('unknown grab candidate');
  state.grab.image = img;
  ctx.note('P6 [human select] → grab_image_1');
  const occ = await ctx.step('P6 [model_1 evaluate] grab_image_1 → occlusion_1', () => ops.evaluateOcclusion(img.png), (o) => `${o.occlusion}: ${o.reason}`);
  state.grab.occlusion = occ.occlusion;
  state.grab.occlusionReason = occ.reason;
  const iso = await ctx.step('P6 [model_2 generate]~ → isolated_grab_1', async () => toImageArtifact(await ops.generateIsolatedGrab(img.svg, occ.occlusion, occ.reason), 'isolated grab'));
  state.grab.isolated = iso;
  const mask = await ctx.step('P6 [tool_1 extract] isolated_grab_1 → grab_mask_1', () => foregroundMask(iso.svg), (m) => `${area(m)} px`);
  const seg = await ctx.step('P6 [tool_1 translate] grab_mask_1 → grab_element_1', () => {
    const s = maskToSegment(mask, { id: newId('grab'), label: state.grab.request ?? 'grabbed element', layerId: '', color: meanColor(iso.svg, mask), source: 'grab' });
    if (!s) throw new Error('Empty grab mask');
    return s;
  });
  state.grab.element = stripMask(seg);
  state.grabbedElements.push(seg);
}


// ---------- Process 7: human modify on the canvas ----------
export type CanvasOp =
  | { op: 'move'; id: string; dx: number; dy: number }
  | { op: 'setLayer'; id: string; layerId: string }
  | { op: 'setColor'; id: string; color: string }
  | { op: 'delete'; id: string }
  | { op: 'toggleLayer'; layerId: string }
  | { op: 'moveLayer'; layerId: string; dir: -1 | 1 }
  | { op: 'renameLayer'; layerId: string; name: string }
  | { op: 'addLayer'; name: string }
  | { op: 'placeGrab'; grabId: string; layerId: string }
  | { op: 'scale'; id: string; factor: number };

export function p7Modify(o: CanvasOp) {
  const c = state.canvas;
  if (!c) throw new Error('No canvas');
  const next: Canvas<StoredSegment> = structuredClone(c);
  const seg = (id: string) => {
    const s = next.segments.find((x) => x.id === id);
    if (!s) throw new Error('unknown segment ' + id);
    return s;
  };
  const layer = (id: string) => {
    const l = next.layers.find((x) => x.id === id);
    if (!l) throw new Error('unknown layer ' + id);
    return l;
  };
  let note: string = o.op;
  switch (o.op) {
    case 'move': {
      const s = seg(o.id);
      s.dx = Math.round(o.dx);
      s.dy = Math.round(o.dy);
      note = `moved ${s.label}`;
      break;
    }
    case 'setLayer':
      layer(o.layerId);
      seg(o.id).layerId = o.layerId;
      note = `moved ${seg(o.id).label} to ${layer(o.layerId).name}`;
      break;
    case 'setColor':
      if (!/^#[0-9a-f]{6}$/i.test(o.color)) throw new Error('bad colour');
      seg(o.id).color = o.color;
      note = `recoloured ${seg(o.id).label}`;
      break;
    case 'delete':
      note = `deleted ${seg(o.id).label}`;
      next.segments = next.segments.filter((s) => s.id !== o.id);
      break;
    case 'toggleLayer':
      layer(o.layerId).visible = !layer(o.layerId).visible;
      break;
    case 'moveLayer': {
      const sorted = [...next.layers].sort((a, b) => a.depth - b.depth);
      const i = sorted.findIndex((l) => l.id === o.layerId);
      const j = i + o.dir;
      if (i < 0 || j < 0 || j >= sorted.length) break;
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      sorted.forEach((l, k) => (l.depth = k));
      next.layers = sorted;
      note = `reordered ${layer(o.layerId).name}`;
      break;
    }
    case 'renameLayer':
      layer(o.layerId).name = o.name.slice(0, 60);
      break;
    case 'addLayer': {
      const id = newId('layer');
      next.layers.push({ id, name: o.name || 'New layer', depth: next.layers.length, visible: true });
      note = `added layer ${o.name}`;
      break;
    }
    case 'placeGrab': {
      const g = state.grabbedElements.find((x) => x.id === o.grabId);
      if (!g) throw new Error('unknown grabbed element');
      layer(o.layerId);
      // placed grabs start at roughly a quarter of the canvas, centred where they were drawn
      const f = Math.min(1, (W * 0.28) / Math.max(g.bbox.w, g.bbox.h));
      const m = scaleMask(decodeMask(g), f, g.bbox.x + g.bbox.w / 2, g.bbox.y + g.bbox.h / 2);
      const placed = withMask({ ...structuredClone(g), id: newId('seg'), layerId: o.layerId }, m);
      if (!placed) throw new Error('grabbed element vanished when scaled');
      next.segments.push(placed);
      note = `placed ${g.label}`;
      break;
    }
    case 'scale': {
      const s = seg(o.id);
      const f = Math.max(0.2, Math.min(5, Number(o.factor)));
      const m = scaleMask(decodeMask(s), f, s.bbox.x + s.bbox.w / 2, s.bbox.y + s.bbox.h / 2);
      const scaled = withMask(s, m);
      if (!scaled) throw new Error('piece would vanish');
      next.segments = next.segments.map((x) => (x.id === s.id ? scaled : x));
      note = `scaled ${s.label} ×${f}`;
      break;
    }
  }
  commitCanvas(next, note);
}

// ---------- helpers for crop framing ----------
function cropBox(s: StoredSegment, pad = 12) {
  const side = Math.max(s.bbox.w, s.bbox.h) + pad * 2;
  const cx = s.bbox.x + s.bbox.w / 2;
  const cy = s.bbox.y + s.bbox.h / 2;
  return { x: cx - side / 2, y: cy - side / 2, side };
}
/** Map a 512×512 mask drawn in crop space back into canvas space. */
function uncrop(m: Mask, box: { x: number; y: number; side: number }): Mask {
  const out = emptyMask();
  const k = W / box.side;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = Math.floor((x - box.x) * k), v = Math.floor((y - box.y) * k);
      if (u >= 0 && v >= 0 && u < W && v < H && m[v * W + u]) out[y * W + x] = 1;
    }
  return out;
}

// ---------- Process 8 ----------
export async function p8Repair(ctx: JobCtx, segmentId: string) {
  const src = currentSource();
  const c = state.canvas;
  const target = c?.segments.find((s) => s.id === segmentId);
  if (!src || !c || !target) throw new Error('Need a source image and a canvas element');
  ctx.note('P8 [human select] canvas_1 → repair_target_1', target.label);
  const box = cropBox(target);
  const crop = await ctx.step('P8 [tool_1 extract] source_image_1 → element_crop_1', () => cropSvg(src.svg, { x: box.x, y: box.y, w: box.side, h: box.side }));
  const repaired = await ctx.step('P8 [model_2 modify]~ element_crop_1 → repaired_element_1', async () => normalizeSvg(await ops.repairElement(crop, target.label)));
  const geom = await ctx.step('P8 [tool_1 translate] repaired_element_1 → repaired_geometry_1', () => {
    const m = uncrop(foregroundMask(repaired), box);
    if (!area(m)) throw new Error('Repaired element is empty');
    return maskToSegment(m, { ...target, source: 'repaired' })!;
  }, (g) => `${g.area} px (was ${target.area})`);
  const next = structuredClone(c);
  next.segments = next.segments.map((s) => (s.id === segmentId ? { ...geom, dx: target.dx, dy: target.dy } : s));
  commitCanvas(next, `repaired ${target.label}`);
  return { crop: 'data:image/png;base64,' + renderPng(normalizeSvg(crop)).toString('base64'), repaired: 'data:image/png;base64,' + renderPng(repaired).toString('base64') };
}

// ---------- Process 9 ----------
export async function p9Split(ctx: JobCtx, segmentId: string, request: string) {
  const c = state.canvas;
  const target = c?.segments.find((s) => s.id === segmentId);
  if (!c || !target) throw new Error('Unknown element');
  ctx.note('P9 [human select] → split_target_1', target.label);
  ctx.note('P9 [human specify] → split_request_1', request);
  const box = cropBox(target, 6);
  const silhouette = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.side} ${box.side}" width="512" height="512"><rect x="${box.x}" y="${box.y}" width="${box.side}" height="${box.side}" fill="#ffffff"/><path d="${target.path}" fill="${target.color}" fill-rule="evenodd"/></svg>`;
  const png = 'data:image/png;base64,' + renderPng(silhouette).toString('base64');
  const parts = await ctx.step('P9 [model_1 extract] → part_prompts_1*', () => ops.extractPartPrompts(png, target.label, request), (p) => p.map((x) => x.label).join(', '));
  const results = await ctx.step('P9 [model_3 extract] → part_masks_1*', () => ops.segment({ op: 'extract part_masks', png, prompts: parts, polygonsOnly: true }));
  const pieces = await ctx.step('P9 [tool_1 translate] part_masks_1* → split_parts_1*', () => {
    const whole = decodeMask(target);
    const masks = parts.map((p) => {
      const r = results.find((x) => x.itemId === p.itemId);
      const polys = (r?.polygons ?? []).filter((q) => q.length >= 3) as [number, number][][];
      return intersect(uncrop(polygonsToMask(polys), box), whole);
    });
    assignRemainder(whole, masks);
    const out: StoredSegment[] = [];
    masks.forEach((m, i) => {
      const s = maskToSegment(m, { id: newId('seg'), label: `${target.label} — ${parts[i].label}`, layerId: target.layerId, color: target.color, source: 'split', dx: target.dx, dy: target.dy });
      if (s) out.push(s);
    });
    if (out.length < 2) throw new Error('Split produced fewer than two parts');
    return out;
  }, (p) => `${p.length} parts`);
  const next = structuredClone(c);
  const idx = next.segments.findIndex((s) => s.id === segmentId);
  next.segments.splice(idx, 1, ...pieces);
  commitCanvas(next, `split ${target.label}`);
}

/** Give every pixel of `whole` to exactly one part: remove overlaps, then grow parts into unclaimed pixels. */
export function assignRemainder(whole: Mask, masks: Mask[]) {
  const owner = new Int16Array(W * H).fill(-1);
  masks.forEach((m, k) => {
    for (let i = 0; i < m.length; i++) if (m[i] && owner[i] < 0) owner[i] = k;
  });
  let frontier: number[] = [];
  for (let i = 0; i < owner.length; i++) if (owner[i] >= 0) frontier.push(i);
  while (frontier.length) {
    const nextF: number[] = [];
    for (const p of frontier) {
      const x = p % W, y = (p / W) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
        if (q >= 0 && whole[q] && owner[q] < 0) (owner[q] = owner[p]), nextF.push(q);
    }
    frontier = nextF;
  }
  masks.forEach((m, k) => {
    for (let i = 0; i < m.length; i++) m[i] = whole[i] && owner[i] === k ? 1 : 0;
  });
}
