// Thin client for the model operations in server/operations.ts.
export async function api<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}
