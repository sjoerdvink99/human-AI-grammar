import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export function Section({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("mt-10", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {aside && <div className="text-xs text-faint">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
