import type { IllustrationRequest, Point, TextItem, VisualElement } from "../shared/types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || (j.error && !j.polygon)) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

/** model_1 generate (process 1). */
export const generateElements = (brief: string, styleRefs: TextItem[], documents: TextItem[]) =>
  post<{ elements: VisualElement[] }>("/api/elements", { brief, styleRefs, documents });

/** model_2 generate (process 4). */
export const generateIllustration = (request: IllustrationRequest) =>
  post<{ svg: string; alt: string }>("/api/illustrate", { request });

/** model_3 extract (processes 6 & 7). */
export const extractObject = (body: {
  crop: string;
  annotated: string;
  width: number;
  height: number;
  points: { x: number; y: number; positive: boolean }[];
}) => post<{ polygon: Point[]; label: string; warning?: string; attempts: number }>("/api/extract", body);
