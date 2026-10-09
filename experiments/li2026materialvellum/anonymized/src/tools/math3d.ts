// Small 3D math helpers shared by the scene engine (tool_2) and renderer (tool_3).
import type { Camera, Vec3 } from "../shared/types";

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const sub = (a: Vec3, b: Vec3) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const add = (a: Vec3, b: Vec3) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const scale = (a: Vec3, s: number) => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const norm = (a: Vec3) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return scale(a, 1 / l); };

const rad = (d: number) => (d * Math.PI) / 180;

/** World-space eye position for an orbit camera (y is up). */
export function eyeOf(cam: Camera): Vec3 {
  const cp = Math.cos(rad(cam.pitch));
  return add(cam.target, v3(
    cam.distance * cp * Math.sin(rad(cam.yaw)),
    cam.distance * Math.sin(rad(cam.pitch)),
    cam.distance * cp * Math.cos(rad(cam.yaw)),
  ));
}

export interface ViewBasis { eye: Vec3; right: Vec3; up: Vec3; fwd: Vec3 }

export function basisOf(cam: Camera): ViewBasis {
  const eye = eyeOf(cam);
  const fwd = norm(sub(cam.target, eye));
  const right = norm(cross(fwd, v3(0, 1, 0)));
  const up = cross(right, fwd);
  return { eye, right, up, fwd };
}

/** World → camera space (x right, y up, z forward/depth). */
export function toCamera(p: Vec3, b: ViewBasis): Vec3 {
  const d = sub(p, b.eye);
  return v3(dot(d, b.right), dot(d, b.up), dot(d, b.fwd));
}

export const NEAR = 0.5;

/** Clip a polygon in camera space against z >= NEAR (Sutherland–Hodgman). */
export function clipNear(poly: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = a.z >= NEAR, bin = b.z >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a.z) / (b.z - a.z);
      out.push(add(a, scale(sub(b, a), t)));
    }
  }
  return out;
}

/** Camera space → screen pixels. */
export function project(p: Vec3, cam: Camera, w: number, h: number): { x: number; y: number } {
  const f = (h / 2) / Math.tan(rad(cam.fov) / 2);
  return { x: w / 2 + (p.x / p.z) * f, y: h / 2 - (p.y / p.z) * f };
}
