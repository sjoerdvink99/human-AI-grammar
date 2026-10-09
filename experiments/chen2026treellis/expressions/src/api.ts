import type { GenerationInput, ScopedInput } from '../shared/compose';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

/** [model generate]~ (processes 1 and 6) */
export const generateScene = (input: GenerationInput) =>
  post<{ scene: string }>('/api/generate', input).then((r) => r.scene);

/** [model modify]~ (process 5) */
export const modifySubtree = (input: ScopedInput) =>
  post<{ subtree: string }>('/api/modify-subtree', input).then((r) => r.subtree);
