import type { Session, MusicAttributes } from '../../server/types.ts';
import type { TherapyFramework } from '../../server/framework.ts';

export type { Session, MusicAttributes, TherapyFramework };
export interface View { session: Session; framework: TherapyFramework; busy: string | null }

export async function post(path: string, body?: unknown): Promise<View> {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export async function getSession(): Promise<View> {
  return (await fetch('/api/session')).json();
}

export async function getStatus(): Promise<string | null> {
  return (await (await fetch('/api/status')).json()).busy;
}
