/** Thin client for the model endpoints (all model steps run on the server). */
async function post<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/model/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  /** model_1 generate~ */
  themes: (r3: string) => post<{ r4: string }>("themes", { r3 }),
  /** model_2 generate~ */
  illustrate: (prompt: string) => post<{ svg: string }>("illustrate", { prompt }),
  /** model_3 extract */
  segment: (elements: unknown[], selections: unknown[]) =>
    post<{ segments: { name: string; selection?: number; elementIds: string[] }[] }>("segment", { elements, selections }),
  /** model_4 generate~ */
  describe: (r15: string, label: { name: string; field?: string }) => post<{ r17: string }>("describe", { r15, label }),
  /** model_5 generate~ */
  variant: (r18: string, r16: { w: number; h: number }) => post<{ svg: string }>("variant", { r18, r16 }),
};
