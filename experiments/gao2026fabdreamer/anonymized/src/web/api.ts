// Client for the model operations. Each call corresponds to one [model op] in the design.
export async function model<T>(op: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/model/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Run async jobs with a concurrency limit, preserving order. */
export async function pool<I, O>(items: I[], limit: number, fn: (item: I, i: number) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
