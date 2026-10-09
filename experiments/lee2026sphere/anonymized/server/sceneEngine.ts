// Deterministic scene tools: tool_1 (generate), tool_3 compose (layout spec), tool_2 (scene engine).
import type {
  ChosenAsset, CompositeMember, ComposedCommand, EditOp, Graph, Layout, LayoutSpec, Library, PlacedObject,
  PlacementRequest, Scene, SceneView, SpatialSelection,
} from '../shared/types.ts';

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------- tool_1 generate: r9 → r10 + r11
export function generatePlacementRequest(chosen: ChosenAsset[], library: Library, request: string): { placementRequest: PlacementRequest; scene: Scene } {
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  const instances: PlacementRequest['instances'] = [];
  for (const c of chosen) {
    const a = byId.get(c.assetId);
    if (!a) continue;
    for (let i = 0; i < Math.max(1, Math.min(8, c.count)); i++) {
      instances.push({ instanceId: `${a.id}#${i + 1}`, assetId: a.id, slot: c.slot, w: a.w, h: a.h, placement: a.placement, composite: a.composite?.members });
    }
  }
  const area = instances.reduce((s, i) => s + i.w * i.h, 0);
  const target = Math.max(area * 3.2, 400 * 320);
  const width = Math.round(Math.sqrt(target * 1.25) / 10) * 10;
  const depth = Math.round(target / width / 10) * 10;
  const title = request.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Untitled scene';
  return {
    placementRequest: { instances },
    scene: { id: uid('scene'), title, request, room: { width, depth }, createdAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------- tool_3 compose: r1 + r10 + r9 → r12
const AFFINITY: Record<string, string[]> = {
  dining_chair: ['dining_table', 'round_table', 'kitchen_island'],
  stool: ['kitchen_island', 'round_table'],
  office_chair: ['desk'],
  computer: ['desk'],
  floor_lamp: ['armchair', 'sofa', 'loveseat', 'bed_double', 'desk'],
  table_lamp: ['side_table', 'nightstand', 'desk'],
  side_table: ['armchair', 'sofa', 'loveseat'],
  nightstand: ['bed_double', 'bed_single'],
  coffee_table: ['sofa', 'loveseat'],
  armchair: ['coffee_table', 'rug', 'fireplace', 'bookshelf'],
  fern: ['sofa', 'armchair', 'bookshelf'],
  beanbag: ['play_mat', 'tv_stand'],
  lounger: ['parasol'],
};

export function composeLayoutSpec(request: string, placementRequest: PlacementRequest, chosen: ChosenAsset[], scene: Scene): LayoutSpec {
  const hints: LayoutSpec['hints'] = [];
  const text = request.toLowerCase();
  const findInstance = (word: string) =>
    placementRequest.instances.find((i) => i.assetId.includes(word) || i.slot.toLowerCase().includes(word) || word.includes(i.assetId.split('_')[0]));
  for (const m of text.matchAll(/(\w+)\s+(?:next to|near|beside|by)\s+(?:the|a|an)?\s*(\w+)/g)) {
    const a = findInstance(m[1]); const b = findInstance(m[2]);
    if (a && b && a !== b) hints.push({ kind: 'near', a: a.instanceId, b: b.instanceId });
  }
  for (const m of text.matchAll(/(\w+)\s+in\s+(?:the|a)\s+corner/g)) { const a = findInstance(m[1]); if (a) hints.push({ kind: 'corner', a: a.instanceId }); }
  for (const m of text.matchAll(/(\w+)\s+in\s+the\s+(?:center|centre|middle)/g)) { const a = findInstance(m[1]); if (a) hints.push({ kind: 'center', a: a.instanceId }); }
  for (const m of text.matchAll(/(\w+)\s+against\s+the\s+wall/g)) { const a = findInstance(m[1]); if (a) hints.push({ kind: 'against-wall', a: a.instanceId }); }
  // default affinities for items without an explicit hint
  for (const inst of placementRequest.instances) {
    if (hints.some((h) => h.a === inst.instanceId)) continue;
    const partners = AFFINITY[inst.assetId] ?? [];
    const partner = partners.map((p) => placementRequest.instances.find((i) => i.assetId === p)).find(Boolean);
    if (partner) hints.push({ kind: 'near', a: inst.instanceId, b: partner.instanceId });
  }
  const seed = [...scene.id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) + chosen.length;
  return { room: scene.room, instances: placementRequest.instances, hints, seed };
}

// ---------------------------------------------------------------- tool_1 generate: r12 → r13 (layout solver)
interface Box { x: number; y: number; w: number; h: number } // center-based, axis aligned (rotated footprint)
const overlaps = (a: Box, b: Box, pad = 4) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + pad && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad;
const footprint = (w: number, h: number, rot: number) => (rot % 180 === 0 ? { w, h } : { w: h, h: w });

export function generateSceneGraph(spec: LayoutSpec): Graph {
  const { width: W, depth: D } = spec.room;
  const placed: { id: string; box: Box; rot: number; relation: string; target?: string; inst: LayoutSpec['instances'][number] }[] = [];
  const free = (b: Box, ignoreCenterRug = true) =>
    b.x - b.w / 2 >= 0 && b.y - b.h / 2 >= 0 && b.x + b.w / 2 <= W && b.y + b.h / 2 <= D &&
    !placed.some((p) => !(ignoreCenterRug && (p.inst.assetId === 'rug' || p.inst.assetId === 'play_mat')) && overlaps(p.box, b));
  const hintFor = (id: string) => spec.hints.find((h) => h.a === id);
  const wallCursor = [20, 20, 20, 20]; // top, right, bottom, left

  const tryWall = (inst: LayoutSpec['instances'][number]) => {
    for (let pass = 0; pass < 4; pass++) {
      for (let k = 0; k < 4; k++) {
        const wall = (k + pass) % 4;
        const rot = [0, 90, 180, 270][wall];
        const f = footprint(inst.w, inst.h, rot);
        const along = wall % 2 === 0 ? W : D;
        for (let c = wallCursor[wall]; c + (wall % 2 === 0 ? f.w : f.h) <= along - 10; c += 10) {
          const box: Box = wall === 0 ? { x: c + f.w / 2, y: f.h / 2, ...f }
            : wall === 1 ? { x: W - f.w / 2, y: c + f.h / 2, ...f }
            : wall === 2 ? { x: W - c - f.w / 2, y: D - f.h / 2, ...f }
            : { x: f.w / 2, y: D - c - f.h / 2, ...f };
          if (free(box)) { wallCursor[wall] = c + (wall % 2 === 0 ? f.w : f.h) + 15; return { box, rot, relation: `against-wall:${['north', 'east', 'south', 'west'][wall]}` }; }
        }
      }
      wallCursor.fill(20);
    }
    return null;
  };
  const tryCorner = (inst: LayoutSpec['instances'][number]) => {
    for (const [cx, cy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const box: Box = { x: cx ? W - inst.w / 2 : inst.w / 2, y: cy ? D - inst.h / 2 : inst.h / 2, w: inst.w, h: inst.h };
      if (free(box)) return { box, rot: 0, relation: 'in-corner' };
    }
    return null;
  };
  const tryCenter = (inst: LayoutSpec['instances'][number]) => {
    const isFloor = inst.assetId === 'rug' || inst.assetId === 'play_mat';
    for (let r = 0; r < 300; r += 20) for (let a = 0; a < 8; a++) {
      const box: Box = { x: W / 2 + Math.cos((a * Math.PI) / 4) * r, y: D / 2 + Math.sin((a * Math.PI) / 4) * r, w: inst.w, h: inst.h };
      if (isFloor ? box.x - box.w / 2 >= 0 && box.x + box.w / 2 <= W : free(box)) return { box, rot: 0, relation: 'centered' };
      if (r === 0) break;
    }
    return null;
  };
  const tryNear = (inst: LayoutSpec['instances'][number], targetId: string) => {
    const t = placed.find((p) => p.id === targetId);
    if (!t) return null;
    const siblings = placed.filter((p) => p.target === targetId).length;
    const order = [0, 2, 1, 3, 4, 5, 6, 7].map((i) => (i + siblings) % 8);
    for (let gap = 5; gap <= 80; gap += 25) for (const i of order) {
      const side = i % 4;
      const along = i < 4 ? 0 : (i % 2 ? -0.3 : 0.3);
      const rot = [0, 90, 180, 270][side]; // front (south at rot 0) faces the target
      const f = footprint(inst.w, inst.h, rot);
      const box: Box = side === 0 ? { x: t.box.x + along * t.box.w, y: t.box.y - t.box.h / 2 - f.h / 2 - gap, ...f }
        : side === 1 ? { x: t.box.x + t.box.w / 2 + f.w / 2 + gap, y: t.box.y + along * t.box.h, ...f }
        : side === 2 ? { x: t.box.x + along * t.box.w, y: t.box.y + t.box.h / 2 + f.h / 2 + gap, ...f }
        : { x: t.box.x - t.box.w / 2 - f.w / 2 - gap, y: t.box.y + along * t.box.h, ...f };
      if (free(box)) return { box, rot, relation: `near:${targetId}` , target: targetId };
    }
    return null;
  };
  const tryAnywhere = (inst: LayoutSpec['instances'][number]) => {
    for (let y = inst.h / 2 + 10; y < D; y += 20) for (let x = inst.w / 2 + 10; x < W; x += 20) {
      const box: Box = { x, y, w: inst.w, h: inst.h };
      if (free(box)) return { box, rot: 0, relation: 'free' };
    }
    return { box: { x: W / 2, y: D / 2, w: inst.w, h: inst.h }, rot: 0, relation: 'overlapping' };
  };

  // Anchors first (wall/corner/center), then items that depend on others.
  const rank = (i: LayoutSpec['instances'][number]) => {
    const h = hintFor(i.instanceId);
    if (h?.kind === 'near') return 3;
    return { center: 0, wall: 1, corner: 2, free: 3 }[i.placement];
  };
  const ordered = [...spec.instances].sort((a, b) => rank(a) - rank(b) || b.w * b.h - a.w * a.h);
  for (const inst of ordered) {
    const h = hintFor(inst.instanceId);
    let r: { box: Box; rot: number; relation: string; target?: string } | null = null;
    if (h?.kind === 'near' && h.b) r = tryNear(inst, h.b);
    else if (h?.kind === 'corner') r = tryCorner(inst);
    else if (h?.kind === 'center') r = tryCenter(inst);
    else if (h?.kind === 'against-wall') r = tryWall(inst);
    if (!r) r = inst.placement === 'wall' ? tryWall(inst) : inst.placement === 'corner' ? tryCorner(inst) ?? tryWall(inst)
      : inst.placement === 'center' ? tryCenter(inst) : null;
    if (!r) r = tryAnywhere(inst);
    placed.push({ id: inst.instanceId, inst, ...r });
  }

  const graph: Graph = { nodes: [{ id: 'room', label: 'Room', data: { ...spec.room } }], edges: [] };
  for (const p of placed) {
    graph.nodes.push({ id: p.id, label: p.inst.assetId, data: { x: p.box.x, y: p.box.y, w: p.inst.w, h: p.inst.h, rot: p.rot, composite: p.inst.composite } });
    graph.edges.push({ source: 'room', target: p.id, relation: 'contains' });
    if (p.target) graph.edges.push({ source: p.id, target: p.target, relation: 'near' });
    else graph.edges.push({ source: p.id, target: 'room', relation: p.relation });
  }
  return graph;
}

// ---------------------------------------------------------------- tool_2 translate: r13 → r14 + r15
export function graphToLayout(graph: Graph, library: Library): { layout: Layout; view: SceneView } {
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  const layout: Layout = [];
  for (const n of graph.nodes) {
    if (n.id === 'room') continue;
    const d = n.data as { x: number; y: number; w: number; h: number; rot: number; composite?: CompositeMember[] };
    const asset = byId.get(n.label);
    if (d.composite && d.composite.length) {
      // expand composite asset into its members, rotated with the group
      const rad = (d.rot * Math.PI) / 180;
      for (const m of d.composite) {
        const ma = byId.get(m.assetId);
        if (!ma) continue;
        layout.push({
          id: uid(ma.id), assetId: ma.id, name: ma.name,
          x: d.x + m.dx * Math.cos(rad) - m.dy * Math.sin(rad), y: d.y + m.dx * Math.sin(rad) + m.dy * Math.cos(rad),
          w: ma.w, h: ma.h, rot: (m.rot + d.rot) % 360, color: m.color ?? ma.color, shape: ma.shape,
        });
      }
      continue;
    }
    layout.push({
      id: uid(n.label), assetId: n.label, name: asset?.name ?? n.label, x: d.x, y: d.y, w: d.w, h: d.h, rot: d.rot,
      color: asset?.color ?? '#999', shape: asset?.shape ?? 'rect',
    });
  }
  return { layout, view: { scale: 1, showGrid: true, editLog: [] } };
}

// ---------------------------------------------------------------- tool_2 compose: r16 + r18 → r19
export function composeCommand(utterance: string, selection: SpatialSelection, layout: Layout, scene: Scene): ComposedCommand {
  const inRegion = (o: PlacedObject) => selection.region &&
    o.x >= selection.region.x && o.x <= selection.region.x + selection.region.w && o.y >= selection.region.y && o.y <= selection.region.y + selection.region.h;
  const ids = new Set([...selection.objectIds, ...layout.filter(inRegion).map((o) => o.id)]);
  const pick = ({ id, name, x, y, w, h, rot, color }: PlacedObject) => ({ id, name, x: Math.round(x), y: Math.round(y), w, h, rot, color });
  return {
    utterance: utterance.trim(),
    selection: { objectIds: [...ids], objects: layout.filter((o) => ids.has(o.id)).map(pick), region: selection.region },
    room: scene.room,
    objects: layout.map(({ id, name, x, y, w, h, rot }) => ({ id, name, x: Math.round(x), y: Math.round(y), w, h, rot })),
  };
}

// ---------------------------------------------------------------- tool_2 execute: r21* → r14
export function executeOps(layout: Layout, ops: EditOp[], scene: Scene): Layout {
  let next = layout.map((o) => ({ ...o }));
  const clamp = (o: PlacedObject) => {
    const f = footprint(o.w, o.h, o.rot);
    o.x = Math.min(Math.max(o.x, f.w / 2), scene.room.width - f.w / 2);
    o.y = Math.min(Math.max(o.y, f.h / 2), scene.room.depth - f.h / 2);
  };
  for (const op of ops) {
    const o = next.find((x) => x.id === op.target);
    if (!o) continue;
    switch (op.op) {
      case 'move': o.x += op.dx; o.y += op.dy; break;
      case 'moveTo': o.x = op.x; o.y = op.y; break;
      case 'rotate': o.rot = (((o.rot + op.degrees) % 360) + 360) % 360; break;
      case 'scale': { const f = Math.min(Math.max(op.factor, 0.25), 4); o.w = Math.round(o.w * f); o.h = Math.round(o.h * f); break; }
      case 'recolor': o.color = op.color; break;
      case 'delete': next = next.filter((x) => x !== o); continue;
      case 'duplicate': { const c = { ...o, id: uid(o.assetId), x: o.x + op.dx, y: o.y + op.dy }; clamp(c); next.push(c); continue; }
    }
    clamp(o);
  }
  return next;
}
