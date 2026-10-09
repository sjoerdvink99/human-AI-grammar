// Client for POST /api/op/<name>. Every design operation run on the server goes through here.
export async function op<T = any>(name: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/op/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}
