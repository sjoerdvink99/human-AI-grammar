import { useEffect, useState } from 'react';
import type { Project } from '../shared/types';

const KEY = 'story-vignette-project-v1';
export const emptyProject = (): Project => ({
  story: '', characters: [], layoutId: null, layoutReason: '', roomLabels: {}, objects: [],
  environment: null, activities: [], events: [], vignetteId: null,
});

/** The authoring project, persisted to localStorage. */
export function useProject() {
  const [project, setProject] = useState<Project>(() => {
    try { return { ...emptyProject(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return emptyProject(); }
  });
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(project)); }, [project]);
  const update = (patch: Partial<Project> | ((p: Project) => Partial<Project>)) =>
    setProject((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) }));
  return { project, update, reset: () => setProject(emptyProject()) };
}

/** Small helper for async buttons with loading + error state. */
export function useTask() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message ?? String(e)); } finally { setBusy(null); }
  };
  return { busy, error, run, setBusy };
}
