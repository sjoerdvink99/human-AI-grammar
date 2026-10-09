import { CANVAS, sanitizeSvg } from "./sanitize";
import type { IllustrationRequest, Scene, SceneSpec, Snapshot, VisualElement } from "./types";

const KIND_Z: Record<string, number> = { shape: 0, illustration: 1, icon: 2, annotation: 3, text: 4, headline: 5 };

/** tool_1 compose (process 1 & 3): elements r4* → scene spec r5. */
export function composeSceneSpec(elements: VisualElement[], background = "#fbf8f3"): SceneSpec {
  return {
    width: CANVAS.width,
    height: CANVAS.height,
    background,
    layers: elements
      .map((e, i) => ({
        elementId: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
        color: e.color,
        svg: sanitizeSvg(e.svg),
        text: e.text,
        z: (KIND_Z[e.kind] ?? 0) * 1000 + i,
      }))
      .sort((a, b) => a.z - b.z),
  };
}

/** tool_7 compose (process 1 & 3): add the rendered scene r6 to the gallery r7*. Earlier rounds are kept. */
export function addSnapshot(snapshots: Snapshot[], scene: Scene, critique?: string): Snapshot[] {
  const round = snapshots.length ? Math.max(...snapshots.map((s) => s.round)) + 1 : 1;
  return [
    ...snapshots,
    { id: `snap${round}-${Date.now().toString(36)}`, round, createdAt: Date.now(), scene, critique, reviews: [] },
  ];
}

/** tool_1 compose (process 4): selected element r13 → illustration request r14. */
export function composeIllustrationRequest(el: VisualElement, styleHint = ""): IllustrationRequest {
  const ratio = el.w / el.h;
  return {
    subject: el.name,
    description: [el.description, el.text].filter(Boolean).join(" — "),
    style: styleHint || "flat vector infographic illustration, clean shapes, no text",
    palette: [el.color, "#2b2d42", "#f4f1ea"],
    aspect: ratio > 1.25 ? "landscape" : ratio < 0.8 ? "portrait" : "square",
  };
}
