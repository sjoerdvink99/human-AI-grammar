import { useCallback, useState } from "react";

/** Tracks one generative/async step: loading label and error. */
export function useTask() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, run, setError };
}
