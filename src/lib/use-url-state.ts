"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { SystemQuery } from "@/domain/systems/filters";
import { readQuery, writeQuery } from "./query-params";

export function useUrlState() {
  const params = useSearchParams();

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      const search = next.toString();
      const { pathname } = window.location;
      window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
    },
    [params],
  );

  return [params, update] as const;
}

export function useSystemQuery() {
  const [params, update] = useUrlState();
  const query = useMemo(() => readQuery(params), [params]);

  const setQuery = useCallback(
    (changes: Partial<SystemQuery>) => update((next) => writeQuery({ ...readQuery(next), ...changes }, next)),
    [update],
  );

  return { query, setQuery, params, update };
}
