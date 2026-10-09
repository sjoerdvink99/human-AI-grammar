// Client side of the model steps. The server composes the request record and calls the model.

async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Processes 1 and 6: model generate~ → r3. */
export function generate(instruction: string, currentCode: string | undefined, signal: AbortSignal) {
  return post<{ code: string; attempts: number }>('/api/generate', { instruction, current_code: currentCode }, signal);
}

/** Process 5: model modify~ r15 → r14_2. */
export function modifySnippet(
  args: {
    instruction: string;
    snippet: string;
    code: string;
    selection: { node_id: string; start_line: number; end_line: number };
  },
  signal: AbortSignal,
) {
  return post<{ snippet: string; attempts: number }>('/api/modify-snippet', args, signal);
}
