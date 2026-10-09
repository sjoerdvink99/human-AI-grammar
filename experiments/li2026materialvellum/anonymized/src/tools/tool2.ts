// tool_2 — scene engine.
//   P1.4 [tool_2 translate]  r3_1 layout → r4_1 scene (extrusion)
//   P1.7 [tool_2 modify]     r4_1 + r5_2 camera → r4_2 scene
import type { Camera, Layout, Scene3D } from "../shared/types";
import { v3 } from "./math3d";

/** Extrude 2D footprints (metres, origin top-left of plan) into prisms centred on the origin. */
export function extrudeLayout(layout: Layout): Scene3D {
  const cx = layout.extent.w / 2, cz = layout.extent.d / 2;
  return {
    prisms: layout.footprints.map((f) => ({
      id: f.id,
      // plan x → world x, plan y → world z (plan "down" = towards viewer at yaw 0)
      base: f.polygon.map((p) => v3(p.x - cx, 0, p.y - cz)),
      height: f.height,
      color: f.color,
    })),
    ground: { w: layout.extent.w, d: layout.extent.d },
    camera: null,
    version: 1,
  };
}

export function clampCamera(c: Camera): Camera {
  return {
    ...c,
    yaw: ((c.yaw % 360) + 360) % 360,
    pitch: Math.max(5, Math.min(85, c.pitch)),
    distance: Math.max(8, Math.min(200, c.distance)),
    fov: Math.max(20, Math.min(90, c.fov)),
  };
}

/** Apply the (human-modified) camera to the scene, producing the next scene version. */
export function applyCamera(scene: Scene3D, camera: Camera): Scene3D {
  return { ...scene, camera: clampCamera(camera), version: scene.version + 1 };
}
