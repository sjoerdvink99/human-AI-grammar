// Client for the model operations. Each name matches an op in server/ops.ts.
export async function op<T>(name: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/op/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.result as T;
}
