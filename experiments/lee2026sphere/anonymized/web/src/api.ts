export interface StepEvent { type: 'start' | 'step'; rep: string; transform: string; output?: unknown; ms?: number }

/** POST and read the NDJSON stream of transformation events. */
export async function runStream<T>(path: string, body: unknown, onEvent: (e: StepEvent) => void): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'done') return msg.result as T;
      if (msg.type === 'error') throw new Error(msg.message);
      onEvent(msg);
    }
  }
  throw new Error('stream ended unexpectedly');
}
