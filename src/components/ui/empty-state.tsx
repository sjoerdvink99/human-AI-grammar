import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      {children && <div className="mt-1 text-[13px] text-muted">{children}</div>}
    </div>
  );
}
