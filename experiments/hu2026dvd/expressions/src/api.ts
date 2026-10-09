import type { ClipRequest, Guideline, ObjectMask, Project, Scene, VideoAsset } from '../shared/types';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  project: () => j<Project>('/api/project'),
  patch: (p: Partial<Project>) => j<Project>('/api/project', { method: 'PATCH', body: JSON.stringify(p) }),
  reset: () => j<Project>('/api/project/reset', { method: 'POST' }),
  generateScripts: (b: { topic: string; dataFacts: string[]; guidelines: Guideline[] }) =>
    j<{ scripts: Scene[] }>('/api/scripts', { method: 'POST', body: JSON.stringify(b) }),
  generateClip: (r: ClipRequest) => j<{ svg: string; caption: string }>('/api/clip', { method: 'POST', body: JSON.stringify(r) }),
  extractMask: (b: { image: string; width: number; height: number; point: { x: number; y: number } }) =>
    j<ObjectMask>('/api/mask', { method: 'POST', body: JSON.stringify(b) }),
  upload: async (blob: Blob): Promise<{ url: string; mime: string }> => {
    const res = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': blob.type || 'video/mp4' }, body: blob });
    if (!res.ok) throw new Error('upload failed');
    return res.json();
  },
  addVersion: (video: VideoAsset, scripts: Scene[]) =>
    j<Project>('/api/versions', { method: 'POST', body: JSON.stringify({ video, scripts }) }),
  updateVersion: (id: string, b: { assessment?: string; review?: string }) =>
    j<Project>(`/api/versions/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
};
