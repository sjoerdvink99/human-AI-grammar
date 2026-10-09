export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function store<T>(key: string, initial: T) {
  return {
    load(): T {
      try {
        const v = localStorage.getItem(`systemx:${key}`);
        return v ? (JSON.parse(v) as T) : initial;
      } catch {
        return initial;
      }
    },
    save(v: T) {
      localStorage.setItem(`systemx:${key}`, JSON.stringify(v));
    },
  };
}
