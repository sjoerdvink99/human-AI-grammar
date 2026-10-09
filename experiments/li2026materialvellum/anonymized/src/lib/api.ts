// Client for the model steps on the backend.
import type { ItemRecord, Point } from "../shared/types";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}

export const api = {
  /** P1.9 [model_1 generate]~ */
  generateFromRender: (render: string) => post<{ svg: string }>("/api/model1/generate-from-render", { render }),
  /** P1.13 [model_1 modify]~ */
  modify: (image: string, selections: { index: number; polygon: Point[] }[], instructions: string[]) =>
    post<{ edited: string; raw: string }>("/api/model1/modify", { image, selections, instructions }),
  /** P2.4 [model_1 generate]~ */
  generateFromSketch: (sketch: string, description: string) => post<{ svg: string }>("/api/model1/generate-from-sketch", { sketch, description }),
  /** P3.6 [model_2 generate]~ */
  describe: (globalPrompt: string, record: ItemRecord) => post<{ text: string }>("/api/model2/describe", { globalPrompt, record }),
  /** P3.7 [model_1 generate]~ */
  generateItem: (record: ItemRecord, description: string) => post<{ svg: string }>("/api/model1/generate-item", { record, description }),
};

export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function downloadSvg(svg: string, name: string) {
  const a = document.createElement("a");
  a.href = svgUrl(svg);
  a.download = name;
  a.click();
}

let n = 0;
export const uid = (p = "id") => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;
