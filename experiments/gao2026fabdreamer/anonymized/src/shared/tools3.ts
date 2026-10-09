// tool_3 — fabrication checker (evaluate, P10) and edit-op executor (execute, P10).

import type { Assembly, Constraints, EditOp, FabCheck, Part3D } from "./types";
import { aabb, assemblyBounds, type AABB } from "./tools2";
import { materialColor, uid } from "./tools1";

const TOUCH = 2; // mm tolerance for contact
const r1 = (n: number) => Math.round(n * 10) / 10;

function overlap1(a0: number, a1: number, b0: number, b1: number) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }
function touches(a: AABB, b: AABB): boolean {
  return a.min.x <= b.max.x + TOUCH && a.max.x >= b.min.x - TOUCH &&
    a.min.y <= b.max.y + TOUCH && a.max.y >= b.min.y - TOUCH &&
    a.min.z <= b.max.z + TOUCH && a.max.z >= b.min.z - TOUCH;
}
const volume = (p: Part3D) => p.shape === "cylinder" ? Math.PI * (p.size.w / 2) * (p.size.d / 2) * p.size.h : p.size.w * p.size.h * p.size.d;

/** tool_3 evaluate: r27 + r38 → r39*. */
export function runFabChecks(assembly: Assembly, c: Constraints): FabCheck[] {
  const out: FabCheck[] = [];
  const parts = assembly.parts;
  if (!parts.length) return [{ id: "empty", kind: "bounds", severity: "error", partIds: [], message: "The assembly has no parts." }];
  const boxes = new Map(parts.map((p) => [p.id, aabb(p)]));
  const B = assemblyBounds(parts);
  const W = B.max.x - B.min.x, H = B.max.y - B.min.y, D = B.max.z - B.min.z;

  ([["width", W, c.maxW], ["height", H, c.maxH], ["depth", D, c.maxD]] as const).forEach(([n, v, max]) => {
    if (max > 0 && v > max) out.push({ id: `bounds_${n}`, kind: "bounds", severity: "error", partIds: [], message: `Overall ${n} ${r1(v)} mm exceeds the limit of ${max} mm.`, value: r1(v) });
  });

  for (const p of parts) {
    const b = boxes.get(p.id)!;
    if (b.min.y < -1) out.push({ id: `ground_${p.id}`, kind: "ground", severity: "error", partIds: [p.id], message: `${p.name} goes ${r1(-b.min.y)} mm below the ground.`, value: r1(-b.min.y) });
    const minDim = Math.min(p.size.w, p.size.h, p.size.d);
    if (minDim < c.minThickness) out.push({ id: `thin_${p.id}`, kind: "thickness", severity: "error", partIds: [p.id], message: `${p.name} is ${r1(minDim)} mm thick; the minimum is ${c.minThickness} mm.`, value: r1(minDim) });
    if (/sheet/.test(c.method) && p.shape !== "cylinder" && Math.abs(minDim - c.sheetThickness) > 0.5) {
      out.push({ id: `sheet_${p.id}`, kind: "sheet", severity: "warning", partIds: [p.id], message: `${p.name} (${r1(minDim)} mm thin side) cannot be cut from ${c.sheetThickness} mm ${c.material} sheet.`, value: r1(minDim) });
    }
    if (b.min.y > TOUCH) {
      const supported = parts.some((q) => q.id !== p.id && touches(b, boxes.get(q.id)!));
      if (!supported) out.push({ id: `float_${p.id}`, kind: "floating", severity: "error", partIds: [p.id], message: `${p.name} is not touching the ground or any other part.` });
    }
  }

  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = boxes.get(parts[i].id)!, b = boxes.get(parts[j].id)!;
    const v = overlap1(a.min.x, a.max.x, b.min.x, b.max.x) * overlap1(a.min.y, a.max.y, b.min.y, b.max.y) * overlap1(a.min.z, a.max.z, b.min.z, b.max.z);
    const smaller = Math.min(volume(parts[i]), volume(parts[j]));
    if (smaller > 0 && v / smaller > 0.1) out.push({
      id: `overlap_${parts[i].id}_${parts[j].id}`, kind: "overlap", severity: "warning", partIds: [parts[i].id, parts[j].id],
      message: `${parts[i].name} and ${parts[j].name} intersect (${Math.round((100 * v) / smaller)}% of the smaller part).`, value: r1(v / smaller),
    });
  }

  // Stability: centre of mass (uniform density) inside the footprint of the ground-contact parts.
  const grounded = parts.filter((p) => boxes.get(p.id)!.min.y <= TOUCH);
  const total = parts.reduce((s, p) => s + volume(p), 0) || 1;
  const com = { x: parts.reduce((s, p) => s + volume(p) * p.position.x, 0) / total, z: parts.reduce((s, p) => s + volume(p) * p.position.z, 0) / total };
  if (!grounded.length) {
    out.push({ id: "stability", kind: "stability", severity: "error", partIds: [], message: "No part rests on the ground." });
  } else {
    const gx0 = Math.min(...grounded.map((p) => boxes.get(p.id)!.min.x)), gx1 = Math.max(...grounded.map((p) => boxes.get(p.id)!.max.x));
    const gz0 = Math.min(...grounded.map((p) => boxes.get(p.id)!.min.z)), gz1 = Math.max(...grounded.map((p) => boxes.get(p.id)!.max.z));
    const inside = com.x >= gx0 && com.x <= gx1 && com.z >= gz0 && com.z <= gz1;
    const margin = Math.min(com.x - gx0, gx1 - com.x, com.z - gz0, gz1 - com.z);
    const span = Math.min(gx1 - gx0, gz1 - gz0);
    if (!inside) out.push({ id: "stability", kind: "stability", severity: "error", partIds: grounded.map((p) => p.id), message: `Centre of mass (${r1(com.x)}, ${r1(com.z)}) lies outside the support footprint — it will tip over.` });
    else if (margin < span * 0.1) out.push({ id: "stability", kind: "stability", severity: "warning", partIds: grounded.map((p) => p.id), message: `Centre of mass is only ${r1(margin)} mm from the edge of the support footprint.`, value: r1(margin) });
  }

  if (!out.length) out.push({ id: "ok", kind: "bounds", severity: "info", partIds: [], message: `All checks pass (${r1(W)} × ${r1(H)} × ${r1(D)} mm).` });
  return out;
}

/** tool_3 execute: r42 ops applied to r27 → new r27 version. Unknown part ids are skipped and reported. */
export function applyOps(assembly: Assembly, ops: EditOp[]): { assembly: Assembly; skipped: string[] } {
  let parts = assembly.parts.map((p) => ({ ...p, size: { ...p.size }, position: { ...p.position } }));
  const skipped: string[] = [];
  for (const op of ops) {
    if (op.op === "add") {
      if (!op.size || !op.position) { skipped.push(`add without size/position`); continue; }
      const material = op.material ?? "plywood";
      parts.push({
        id: uid("part"), name: op.name ?? "new part", shape: op.shape ?? "box", size: sane(op.size), position: { ...op.position },
        rotationY: op.rotationY ?? 0, color: materialColor(material), material, source: "advisor op",
      });
      continue;
    }
    const p = parts.find((x) => x.id === op.partId);
    if (!p) { skipped.push(`${op.op} ${op.partId ?? "?"}: unknown part`); continue; }
    if (op.op === "delete") parts = parts.filter((x) => x.id !== p.id);
    else if (op.op === "move" && op.position) p.position = { ...op.position };
    else if (op.op === "resize" && op.size) p.size = sane(op.size);
    else if (op.op === "rotate" && typeof op.rotationY === "number") p.rotationY = op.rotationY;
    else skipped.push(`${op.op} ${p.id}: missing values`);
  }
  return { assembly: { parts }, skipped };
}

const sane = (s: { w: number; h: number; d: number }) => ({ w: Math.max(0.5, s.w), h: Math.max(0.5, s.h), d: Math.max(0.5, s.d) });
