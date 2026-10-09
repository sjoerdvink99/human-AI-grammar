export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.result as T;
}
