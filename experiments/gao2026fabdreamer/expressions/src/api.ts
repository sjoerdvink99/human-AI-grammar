import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job, ProjectState } from '../shared/types.ts';

export type ClientState = ProjectState & { canvasHistoryLength: number };

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch('/api' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

/** Runs server jobs (model chains) and polls their step trace. */
export function useJobs(onDone: () => void) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const run = useCallback(
    async (path: string, body?: unknown) => {
      setError(null);
      try {
        const j = await api<Job>(path, body ?? {});
        setJob(j);
        const poll = async () => {
          const cur = await api<Job>(`/jobs/${j.id}`);
          setJob(cur);
          if (cur.status === 'running') timer.current = window.setTimeout(poll, 900);
          else {
            if (cur.status === 'error') setError(cur.error ?? 'failed');
            onDone();
          }
        };
        poll();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [onDone],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const busy = job?.status === 'running';
  return { job, busy, error, setError, run };
}

export type Runner = ReturnType<typeof useJobs>;
