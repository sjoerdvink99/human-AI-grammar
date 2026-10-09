// tool_2 — assembly composer (P7). Rendering (tool_2 translate r27 → r28) is the three.js view in src/web/components/AssemblyView.tsx.

import type { Assembly, Part3D } from "./types";

export interface AABB { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }

export function aabb(p: Part3D): AABB {
  const t = (p.rotationY * Math.PI) / 180;
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const hx = (c * p.size.w + s * p.size.d) / 2;
  const hz = (s * p.size.w + c * p.size.d) / 2;
  const hy = p.size.h / 2;
  const { x, y, z } = p.position;
  return { min: { x: x - hx, y: y - hy, z: z - hz }, max: { x: x + hx, y: y + hy, z: z + hz } };
}

export function assemblyBounds(parts: Part3D[]): AABB {
  if (!parts.length) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const bs = parts.map(aabb);
  return {
    min: { x: Math.min(...bs.map((b) => b.min.x)), y: Math.min(...bs.map((b) => b.min.y)), z: Math.min(...bs.map((b) => b.min.z)) },
    max: { x: Math.max(...bs.map((b) => b.max.x)), y: Math.max(...bs.map((b) => b.max.y)), z: Math.max(...bs.map((b) => b.max.z)) },
  };
}

/**
 * tool_2 compose: r11* → r27. Gives each part a unique id, rests the whole set on the ground
 * (lowest point at y = 0) and centres it on x/z, keeping relative placement.
 */
export function composeAssembly(parts: Part3D[]): Assembly {
  const seen = new Set<string>();
  const copy = parts.map((p, i) => {
    let id = p.id;
    while (seen.has(id)) id = `${p.id}_${i}`;
    seen.add(id);
    return { ...p, id, size: { ...p.size }, position: { ...p.position } };
  });
  if (!copy.length) return { parts: [] };
  const b = assemblyBounds(copy);
  const dx = (b.min.x + b.max.x) / 2, dz = (b.min.z + b.max.z) / 2, dy = b.min.y;
  copy.forEach((p) => {
    p.position = { x: round(p.position.x - dx), y: round(p.position.y - dy), z: round(p.position.z - dz) };
  });
  return { parts: copy };
}

const round = (n: number) => Math.round(n * 100) / 100;
