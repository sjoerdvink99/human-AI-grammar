import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../shared/types';
import { api } from './api';

/** Project state with optimistic local updates and debounced persistence. */
export function useProject() {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Partial<Project>>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api.project().then(setProject, (e) => setError(String(e)));
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = {};
    if (Object.keys(p).length) await api.patch(p);
  }, []);

  const update = useCallback((p: Partial<Project>) => {
    setProject((prev) => (prev ? { ...prev, ...p } : prev));
    pending.current = { ...pending.current, ...p };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 400);
  }, [flush]);

  /** Replace with an authoritative server copy (after flushing local edits). */
  const replace = useCallback((p: Project) => setProject(p), []);

  return { project, update, replace, flush, error };
}

export type ProjectStore = ReturnType<typeof useProject>;

/** Small helper for long-running operations: busy label, progress and error. */
export function useTask() {
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: (progress: (f: number, l?: string) => void) => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    setProgress(null);
    try {
      return await fn((f, l) => {
        setProgress(f);
        if (l) setBusy(l);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, []);
  return { busy, progress, error, run, clearError: () => setError(null) };
}

export const uid = () => Math.random().toString(36).slice(2, 10);
