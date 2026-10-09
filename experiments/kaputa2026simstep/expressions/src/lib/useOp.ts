// Explicit handling of generative/async steps: loading, error, retry.
import { useCallback, useState } from "react";

export function useOp() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<null | (() => Promise<void>)>(null);
  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    const exec = async () => {
      setBusy(label);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(`${label}: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    };
    setLastRun(() => exec);
    await exec();
  }, []);
  return { busy, error, run, retry: lastRun, clearError: () => setError(null) };
}
