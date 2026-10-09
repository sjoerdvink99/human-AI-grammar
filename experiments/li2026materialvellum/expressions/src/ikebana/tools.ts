/** Deterministic tools of process 2 (tool_1 = clean-up of placed elements, tool_3 = converter). */
import { clamp, dist, simplify, smooth } from '../geom';
import type { Point } from '../shared/api';
import type { IkebanaCanvas, IkebanaElement, ScribbleMap } from './types';

export function createIkebanaCanvas(): IkebanaCanvas {
  const W = 400, H = 500;
  const mouth = { x: 200, y: 372 };
  const vase: Point[] = [
    { x: 150, y: 372 }, { x: 250, y: 372 }, { x: 262, y: 395 }, { x: 258, y: 440 },
    { x: 240, y: 470 }, { x: 160, y: 470 }, { x: 142, y: 440 }, { x: 138, y: 395 },
  ];
  return { width: W, height: H, mouth, vase };
}

const SNAP_TO_MOUTH = 80;
const SNAP_FLOWER = 45;

/** [tool_1 modify] ikebana_elements_1 -> ikebana_elements_2 */
export function tool1TidyElements(elements: IkebanaElement[], canvas: IkebanaCanvas): IkebanaElement[] {
  const inCanvas = (p: Point) => ({ x: clamp(p.x, 4, canvas.width - 4), y: clamp(p.y, 4, canvas.height - 4) });
  const stems: IkebanaElement[] = [];
  const out: IkebanaElement[] = [];

  // 1. stems (branch, grass): smooth, orient from the vase outward, snap base into the vase mouth
  let stemIndex = 0;
  for (const e of elements) {
    if (e.kind !== 'branch' && e.kind !== 'grass') continue;
    let pts = smooth(simplify(e.points.map(inCanvas), 3), 2);
    if (pts.length < 2) continue;
    if (dist(pts[pts.length - 1], canvas.mouth) < dist(pts[0], canvas.mouth)) pts = pts.slice().reverse();
    if (dist(pts[0], canvas.mouth) < SNAP_TO_MOUTH) {
      const spread = ((stemIndex++ % 5) - 2) * 8; // stems fan out across the mouth instead of stacking
      pts = [{ x: canvas.mouth.x + spread, y: canvas.mouth.y + 4 }, ...pts.slice(1)];
    }
    const s = { ...e, points: pts };
    stems.push(s);
    out.push(s);
  }
  const stemPoints = stems.flatMap((s) => s.points);
  const stemTips = stems.map((s) => s.points[s.points.length - 1]);

  // 2. leaves: smooth and attach their start to the nearest stem point
  for (const e of elements) {
    if (e.kind !== 'leaf') continue;
    let pts = smooth(simplify(e.points.map(inCanvas), 3), 2);
    if (pts.length < 2) continue;
    const near = nearest(pts[0], stemPoints);
    const nearEnd = nearest(pts[pts.length - 1], stemPoints);
    if (nearEnd && (!near || nearEnd.d < near.d)) pts = pts.slice().reverse();
    const n = nearest(pts[0], stemPoints);
    if (n && n.d < 30) pts = [n.p, ...pts.slice(1)];
    out.push({ ...e, points: pts });
  }

  // 3. flowers: clamp size and snap onto a stem tip when close
  for (const e of elements) {
    if (e.kind !== 'flower') continue;
    let c = inCanvas(e.points[0]);
    const n = nearest(c, stemTips);
    if (n && n.d < SNAP_FLOWER) c = n.p;
    out.push({ ...e, points: [c], size: clamp(e.size, 10, 45) });
  }
  return out;
}

function nearest(p: Point, pts: Point[]): { p: Point; d: number } | null {
  let best: { p: Point; d: number } | null = null;
  for (const q of pts) {
    const d = dist(p, q);
    if (!best || d < best.d) best = { p: q, d };
  }
  return best;
}

const THICKNESS = { branch: 5, grass: 2, leaf: 3, flower: 3 } as const;

function circle(c: Point, r: number, n = 18): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos((i / n) * Math.PI * 2), y: c.y + r * Math.sin((i / n) * Math.PI * 2) }));
}

/** Leaf stroke → closed almond outline so the scribble reads as a leaf. */
function leafOutline(pts: Point[]): Point[] {
  const a = pts[0], b = pts[pts.length - 1];
  const len = dist(a, b) || 1;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const w = Math.min(14, len * 0.25);
  const side = (s: number) => pts.map((p, i) => {
    const t = i / (pts.length - 1);
    const k = Math.sin(t * Math.PI) * w * s;
    return { x: p.x + nx * k, y: p.y + ny * k };
  });
  return [...side(1), ...side(-1).reverse()];
}

function describeStem(e: IkebanaElement, canvas: IkebanaCanvas): string {
  const tip = e.points[e.points.length - 1];
  const height = canvas.mouth.y - tip.y;
  const tall = height > 220 ? 'tall' : height > 110 ? 'medium' : 'low';
  const lean = tip.x < canvas.mouth.x - 40 ? 'leaning left' : tip.x > canvas.mouth.x + 40 ? 'leaning right' : 'upright';
  return `${tall} ${lean}`;
}

/** [tool_3 translate] ikebana_elements_2 -> scribble_map_1 + ikebana_prompt_1 */
export function tool3ElementsToScribble(elements: IkebanaElement[], canvas: IkebanaCanvas): { scribble: ScribbleMap; prompt: string } {
  const strokes = [
    { points: [...canvas.vase, canvas.vase[0]], thickness: 3 },
    ...elements.map((e) => ({
      points: e.kind === 'flower' ? circle(e.points[0], e.size) : e.kind === 'leaf' ? leafOutline(e.points) : e.points,
      thickness: THICKNESS[e.kind],
    })),
  ].map((s) => ({ ...s, points: s.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }));

  let pngDataUrl = '';
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = canvas.width; cv.height = canvas.height;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#000'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.lineWidth = s.thickness;
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    pngDataUrl = cv.toDataURL('image/png');
  }

  const by = (k: IkebanaElement['kind']) => elements.filter((e) => e.kind === k);
  const parts: string[] = [];
  const branches = by('branch');
  if (branches.length) parts.push(`${branches.length} branch${branches.length > 1 ? 'es' : ''} (${branches.map((b) => describeStem(b, canvas)).join('; ')})`);
  const flowers = by('flower');
  if (flowers.length) {
    const big = flowers.filter((f) => f.size >= 28).length;
    parts.push(`${flowers.length} flower${flowers.length > 1 ? 's' : ''}${big ? ` (${big} large bloom${big > 1 ? 's' : ''})` : ''}`);
  }
  const leaves = by('leaf');
  if (leaves.length) parts.push(`${leaves.length} leaf${leaves.length > 1 ? ' elements' : ''}`);
  const grass = by('grass');
  if (grass.length) parts.push(`${grass.length} slender grass blade${grass.length > 1 ? 's' : ''}`);
  const prompt =
    `A Japanese ikebana flower arrangement in a low handmade ceramic vase, made of ${parts.join(', ') || 'a single stem'}. ` +
    'Asymmetrical composition with generous negative space, seasonal natural materials, soft diffuse daylight, ' +
    'plain warm paper-toned background, calm and minimal.';

  return { scribble: { width: canvas.width, height: canvas.height, strokes, pngDataUrl }, prompt };
}
