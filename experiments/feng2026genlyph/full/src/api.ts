// Client for the model endpoints (all model steps run on the server through callModel)
import type { BBox, ShapeStyle } from './types';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  /** model_1 */
  keywords: (datasetDescription: string) => post<{ keywordResponse: string }>('/api/keywords', { datasetDescription }),
  /** model_2 */
  images: (imagePrompt: string) => post<{ images: { title: string; svg: string }[] }>('/api/images', { imagePrompt }),
  /** model_3 */
  segment: (svg: string, shapes: { gid: string; tag: string; bbox: BBox; fill: string }[], box: BBox) =>
    post<{ gids: string[]; name: string }>('/api/segment', { svg, shapes, box }),
  /** model_4 */
  describe: (png: string) => post<{ description: string }>('/api/describe', { png }),
  /** model_5 */
  encode: (edges: { gid: string; tag: string; bbox: BBox }[], prompts: { value: string; prompt: string }[]) =>
    post<{ variants: { value: string; styles: ShapeStyle[] }[] }>('/api/encode', { edges, prompts }),
};
