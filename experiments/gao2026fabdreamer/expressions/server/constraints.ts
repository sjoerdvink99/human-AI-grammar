// Process 10: tool_3 evaluate (fabrication constraint checks) and tool_3 execute (fix tools).
import { z } from 'zod';
import type { Canvas, ConstraintIssue, FixCall, FixOption, FixToolName, MaterialSettings, StoredSegment } from '../shared/types.ts';
import { area, components, decodeMask, dilate, emptyMask, open, placedMask, scaleMask, subtract, union, withMask, W, H, type Mask } from './mask.ts';

export const mmPerPx = (s: MaterialSettings) => s.artworkWidthMm / W;

const opt = (id: string, label: string, tool: FixToolName): FixOption => ({ id, label, tool });

/** tool_3 evaluate: canvas + material_settings → constraint_issues* */
export function evaluateConstraints(canvas: Canvas<StoredSegment>, settings: MaterialSettings): ConstraintIssue[] {
  const issues: ConstraintIssue[] = [];
  const k = mmPerPx(settings);
  const minAreaPx = settings.minPartAreaMm2 / (k * k);
  const rPx = settings.minFeatureMm / k / 2;
  const layers = [...canvas.layers].sort((a, b) => a.depth - b.depth);
  // stable ids: one issue per type per piece (or per canvas)
  let cur: { type: string; seg?: string } = { type: '' };
  const id = () => `${cur.type}${cur.seg ? '_' + cur.seg : ''}`;
  const at = (type: string, seg?: string) => ((cur = { type, seg }), id());

  // sheet overflow: the artwork must fit on one sheet (height = width, square canvas)
  const artH = settings.artworkWidthMm * (canvas.height / canvas.width);
  if (settings.artworkWidthMm > settings.sheetWidthMm || artH > settings.sheetHeightMm)
    issues.push({ id: at('sheet_overflow'), type: 'sheet_overflow', severity: 'error', message: `Artwork (${settings.artworkWidthMm}×${artH.toFixed(0)} mm) is larger than the sheet (${settings.sheetWidthMm}×${settings.sheetHeightMm} mm). Change the material settings.`, measured: settings.artworkWidthMm, limit: settings.sheetWidthMm, options: [] });

  if (layers.length > settings.maxLayers) {
    const options: FixOption[] = [];
    for (let i = 1; i < layers.length; i++) options.push(opt(`merge_${layers[i].id}`, `Merge "${layers[i].name}" into "${layers[i - 1].name}"`, 'mergeLayers'));
    issues.push({ id: at('too_many_layers'), type: 'too_many_layers', severity: 'error', message: `${layers.length} layers but the material stack allows ${settings.maxLayers}.`, measured: layers.length, limit: settings.maxLayers, options });
  }

  const behind = new Map<string, Mask>(); // union of masks of layers strictly behind
  let acc = emptyMask();
  for (const l of layers) {
    behind.set(l.id, acc);
    const segs = canvas.segments.filter((s) => s.layerId === l.id);
    for (const s of segs) acc = union(acc, placedMask(s));
  }

  for (const s of canvas.segments) {
    const layer = layers.find((l) => l.id === s.layerId);
    if (!layer) continue;
    const raw = decodeMask(s);
    const placed = placedMask(s);
    const a = area(placed);
    const where = `"${s.label}" (${layer.name})`;

    if (area(raw) - a > 4)
      issues.push({ id: at('out_of_bounds', s.id), type: 'out_of_bounds', severity: 'warning', layerId: layer.id, segmentId: s.id, message: `${where} extends outside the artwork frame (${((area(raw) - a) * k * k).toFixed(1)} mm² of it lies outside).`, measured: +(((area(raw) - a) * k * k).toFixed(1)), limit: 0, options: [opt('clip', 'Clip to frame', 'clipToFrame'), opt('delete', 'Delete piece', 'deleteSegment')] });

    if (s.source === 'background') continue;

    if (a * k * k < settings.minPartAreaMm2) {
      issues.push({ id: at('too_small', s.id), type: 'small_fragments', severity: 'error', layerId: layer.id, segmentId: s.id, message: `${where} is only ${(a * k * k).toFixed(1)} mm² — too small to cut and handle.`, measured: +(a * k * k).toFixed(1), limit: settings.minPartAreaMm2, options: [opt('scale', 'Enlarge piece', 'scaleSegment'), opt('delete', 'Delete piece', 'deleteSegment')] });
      continue;
    }
    const { sizes } = components(raw);
    const small = sizes.slice(1).filter((v) => v < minAreaPx);
    if (small.length && sizes.length > 2)
      issues.push({ id: at('small_fragments', s.id), type: 'small_fragments', severity: 'warning', layerId: layer.id, segmentId: s.id, message: `${where} has ${small.length} loose fragment(s) smaller than ${settings.minPartAreaMm2} mm².`, measured: small.length, limit: 0, options: [opt('frag', 'Remove small fragments', 'removeSmallFragments'), opt('delete', 'Delete piece', 'deleteSegment')] });

    const thin = area(subtract(raw, open(raw, rPx)));
    if (thin > Math.max(12, 0.01 * area(raw)))
      issues.push({ id: at('thin_feature', s.id), type: 'thin_feature', severity: 'warning', layerId: layer.id, segmentId: s.id, message: `${where} has ${(thin * k * k).toFixed(1)} mm² of features narrower than ${settings.minFeatureMm} mm, which may tear or burn away.`, measured: +(thin * k * k).toFixed(1), limit: settings.minFeatureMm, options: [opt('thicken', `Thicken by ${(settings.minFeatureMm / 2).toFixed(1)} mm`, 'thicken'), opt('trim', 'Trim thin parts', 'removeThinParts'), opt('delete', 'Delete piece', 'deleteSegment')] });

    if (layer.depth > 0) {
      const support = area(intersectCount(placed, behind.get(layer.id)!)) / Math.max(1, a);
      if (support < 0.5) {
        const back = layers[layer.depth - 1];
        issues.push({ id: at('unsupported', s.id), type: 'unsupported', severity: 'warning', layerId: layer.id, segmentId: s.id, message: `Only ${(support * 100).toFixed(0)}% of ${where} rests on layers behind it; it needs something to be glued to.`, measured: +(support * 100).toFixed(0), limit: 50, options: [opt('move_back', `Move to "${back.name}"`, 'moveToLayer'), opt('delete', 'Delete piece', 'deleteSegment')] });
      }
    }
  }
  return issues;
}
const intersectCount = (a: Mask, b: Mask): Mask => a.map((v, i) => v & b[i]) as Mask;

// ---------- tool_3 execute ----------

const argSchemas: Record<FixToolName, z.ZodType<any>> = {
  thicken: z.object({ segmentId: z.string(), mm: z.coerce.number().positive().max(20) }),
  removeThinParts: z.object({ segmentId: z.string(), mm: z.coerce.number().positive().max(20) }),
  removeSmallFragments: z.object({ segmentId: z.string(), minAreaMm2: z.coerce.number().positive() }),
  deleteSegment: z.object({ segmentId: z.string() }),
  moveToLayer: z.object({ segmentId: z.string(), layerId: z.string() }),
  mergeLayers: z.object({ sourceLayerId: z.string(), targetLayerId: z.string() }),
  clipToFrame: z.object({ segmentId: z.string() }),
  scaleSegment: z.object({ segmentId: z.string(), factor: z.coerce.number().min(0.2).max(5) }),
};

/** Validate a fix_call against the tool registry and the current canvas. Throws on invalid calls. */
export function validateFixCall(call: FixCall, canvas: Canvas<StoredSegment>) {
  const schema = argSchemas[call.tool];
  if (!schema) throw new Error('unknown tool ' + call.tool);
  const args = schema.parse(call.args);
  for (const key of ['segmentId'] as const) if (args[key] && !canvas.segments.some((s) => s.id === args[key])) throw new Error(`fix_call refers to unknown segment ${args[key]}`);
  for (const key of ['layerId', 'sourceLayerId', 'targetLayerId']) if (args[key] && !canvas.layers.some((l) => l.id === args[key])) throw new Error(`fix_call refers to unknown layer ${args[key]}`);
  return args;
}

/** tool_3 execute: fix_call → updated canvas */
export function executeFix(call: FixCall, canvas: Canvas<StoredSegment>, settings: MaterialSettings): Canvas<StoredSegment> {
  const args = validateFixCall(call, canvas);
  const next = structuredClone(canvas);
  const k = mmPerPx(settings);
  const idx = next.segments.findIndex((s) => s.id === args.segmentId);
  const seg = idx >= 0 ? next.segments[idx] : undefined;
  const replace = (m: Mask) => {
    const s = withMask(seg!, m);
    if (s) next.segments[idx] = s;
    else next.segments.splice(idx, 1);
  };
  switch (call.tool) {
    case 'thicken':
      replace(dilate(decodeMask(seg!), args.mm / k));
      break;
    case 'removeThinParts':
      replace(open(decodeMask(seg!), args.mm / k / 2));
      break;
    case 'removeSmallFragments': {
      const raw = decodeMask(seg!);
      const { labels, sizes } = components(raw);
      const minPx = args.minAreaMm2 / (k * k);
      const largest = sizes.indexOf(Math.max(...sizes.slice(1)));
      const m = raw.map((_, i) => (labels[i] && (sizes[labels[i]] >= minPx || labels[i] === largest) ? 1 : 0)) as Mask;
      replace(m);
      break;
    }
    case 'deleteSegment':
      next.segments.splice(idx, 1);
      break;
    case 'moveToLayer':
      seg!.layerId = args.layerId;
      break;
    case 'mergeLayers':
      if (args.sourceLayerId === args.targetLayerId) throw new Error('cannot merge a layer into itself');
      next.segments.forEach((s) => s.layerId === args.sourceLayerId && (s.layerId = args.targetLayerId));
      next.layers = next.layers.filter((l) => l.id !== args.sourceLayerId).sort((a, b) => a.depth - b.depth).map((l, i) => ({ ...l, depth: i }));
      break;
    case 'clipToFrame': {
      const m = placedMask(seg!);
      seg!.dx = 0;
      seg!.dy = 0;
      replace(m);
      break;
    }
    case 'scaleSegment': {
      const b = seg!.bbox;
      replace(scaleMask(decodeMask(seg!), args.factor, b.x + b.w / 2, b.y + b.h / 2));
      break;
    }
  }
  return next;
}

export function canvasSummary(c: Canvas<StoredSegment>, settings: MaterialSettings): string {
  const k = mmPerPx(settings);
  return JSON.stringify({
    layers: [...c.layers].sort((a, b) => a.depth - b.depth).map((l) => ({ id: l.id, name: l.name, depth: l.depth })),
    pieces: c.segments.map((s) => ({ id: s.id, label: s.label, layerId: s.layerId, areaMm2: +(s.area * k * k).toFixed(1) })),
  });
}

export { W, H };
