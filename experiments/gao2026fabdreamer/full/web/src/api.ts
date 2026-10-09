import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job, Project } from '../../shared/types';

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body instanceof Blob ? { 'Content-Type': body.type } : body ? { 'Content-Type': 'application/json' } : undefined,
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || res.statusText);
  }
  return res.json();
}

export const fileUrl = (p: Project, f: string) => `/data/${p.id}/${f}`;

/** Runs background jobs (all model steps) with polling, exposing log + status per job slot. */
export function useJobs(onSettled: () => void) {
  const [jobs, setJobs] = useState<Record<string, Job | undefined>>({});
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const run = useCallback(async (slot: string, start: () => Promise<{ jobId: string }>) => {
    try {
      const { jobId } = await start();
      setJobs((j) => ({ ...j, [slot]: { id: jobId, kind: slot, status: 'running', log: [] } }));
      for (;;) {
        await new Promise((r) => setTimeout(r, 1200));
        const job = await api<Job>('GET', `/api/jobs/${jobId}`);
        setJobs((j) => ({ ...j, [slot]: job }));
        settled.current();
        if (job.status !== 'running') return job;
      }
    } catch (e) {
      const job: Job = { id: 'x', kind: slot, status: 'error', log: [], error: (e as Error).message };
      setJobs((j) => ({ ...j, [slot]: job }));
      return job;
    }
  }, []);
  const busy = (slot: string) => jobs[slot]?.status === 'running';
  return { jobs, run, busy };
}

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const reload = useCallback(() => api<Project>('GET', `/api/projects/${id}`).then(setProject), [id]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { project, setProject, reload };
}
