import type { AskResponse, BuildGraphResponse, GroundResponse, SuggestResponse } from "./shared/types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  buildGraph: (b: unknown) => post<BuildGraphResponse>("/api/graph", b), // P1
  ground: (b: unknown) => post<GroundResponse>("/api/ground", b), // P3
  suggest: (b: unknown) => post<SuggestResponse>("/api/suggest", b), // P4
  ask: (b: unknown) => post<AskResponse>("/api/ask", b), // P5
};
