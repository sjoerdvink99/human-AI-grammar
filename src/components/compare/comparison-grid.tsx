import type { ReactNode } from "react";

export function ComparisonGrid({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <div
      className="grid border-t border-line"
      style={{ gridTemplateColumns: `11rem repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function ComparisonRow({ label, hint, cells }: { label: string; hint?: string; cells: ReactNode[] }) {
  return (
    <>
      <div className="border-b border-line py-2.5 pr-4 text-[13px] text-muted">
        {label}
        {hint && <p className="text-xs text-faint">{hint}</p>}
      </div>
      {cells.map((cell, index) => (
        <div key={index} className="min-w-0 border-b border-line px-3 py-2.5 text-[13px]">
          {cell}
        </div>
      ))}
    </>
  );
}

export function SpanningRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="border-b border-line py-2.5 pr-4 text-[13px] text-muted">{label}</div>
      <div className="col-span-full col-start-2 border-b border-line px-3 py-2.5 text-[13px]">{children}</div>
    </>
  );
}
