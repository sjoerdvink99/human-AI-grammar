import type { CodeCandidate, Concept, DerivationRequest, Table } from './shared/types';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

/** compose -> model generate -> evaluate (server). */
export function deriveCandidates(table: Table, concepts: Concept[], request: DerivationRequest) {
  return post<{ prompts: string[]; candidates: CodeCandidate[] }>('/api/derive/candidates', { table, concepts, request });
}

/** execute selected_code on the full table (server). */
export async function deriveApply(table: Table, code: string, name: string): Promise<Table> {
  return (await post<{ table: Table }>('/api/derive/apply', { table, code, name })).table;
}
