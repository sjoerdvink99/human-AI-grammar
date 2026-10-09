import type { Response } from 'express';

export const asObject = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('expected an object');
  return v as Record<string, unknown>;
};
export const asArray = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error('expected an array'); return v; };
export const asNumber = (v: unknown): number => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`expected a number, got ${JSON.stringify(v)}`); return n; };
export const asString = (v: unknown): string => { if (typeof v !== 'string' || !v.trim()) throw new Error('expected a non-empty string'); return v.trim(); };

/** Emits each transformation's output as an NDJSON line so the UI can show progress. */
export interface Emit {
  step<T>(rep: string, transform: string, fn: () => Promise<T>): Promise<T>;
}

export function ndjsonEmitter(res: Response | null): Emit & { send(obj: unknown): void } {
  const send = (obj: unknown) => { res?.write(JSON.stringify(obj) + '\n'); };
  return {
    send,
    async step(rep, transform, fn) {
      send({ type: 'start', rep, transform });
      const t0 = Date.now();
      const output = await fn();
      send({ type: 'step', rep, transform, output, ms: Date.now() - t0 });
      return output;
    },
  };
}
