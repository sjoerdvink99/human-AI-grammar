// Client for the model steps (all model calls happen on the server via callModel()).
import type { Scene, SceneNode } from './shared/scene';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Process 1 (prompt only) and process 6 (followup prompt + current scene). */
export const generateScene = (prompt: string, currentScene?: Scene) => post<{ scene: Scene }>('/api/generate', { prompt, currentScene });

/** Process 5: local AI edit of the subtree under targetId. */
export const editNode = (scene: Scene, targetId: string, request: string) =>
  post<{ scene: Scene; subtree: SceneNode }>('/api/edit-node', { scene, targetId, request });
