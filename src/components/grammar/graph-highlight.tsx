"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface Highlight {
  active: string | null;
  setActive: (id: string | null) => void;
  places: Record<string, string[]>;
}

const HighlightContext = createContext<Highlight | null>(null);

/** Shares the hovered representation between the process graphs of one system, so its uses elsewhere light up too. */
export function GraphHighlight({ places, children }: { places: Record<string, string[]>; children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return <HighlightContext value={{ active, setActive, places }}>{children}</HighlightContext>;
}

export const useGraphHighlight = () => useContext(HighlightContext);
