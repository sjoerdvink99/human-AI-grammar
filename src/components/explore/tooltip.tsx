import type { ReactNode } from "react";

export function Tooltip({ x, y, flip, children }: { x: number; y: number; flip: boolean; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-72 rounded border border-line-strong bg-white px-2.5 py-1.5 text-xs shadow-[0_2px_8px_rgba(15,23,42,0.08)]"
      style={{ left: x + 14, top: y - 12, transform: flip ? "translateX(calc(-100% - 28px))" : undefined }}
    >
      {children}
    </div>
  );
}
