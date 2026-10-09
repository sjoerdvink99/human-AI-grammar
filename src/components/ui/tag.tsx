import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

const tagClass = "inline-flex items-center rounded-sm border px-1.5 py-px text-xs leading-5";

export function Tag({ href, emphasis, children }: { href?: string; emphasis?: boolean; children: ReactNode }) {
  const className = cx(
    tagClass,
    emphasis ? "border-accent/40 bg-accent-wash text-accent" : "border-line bg-wash text-ink",
    href && "hover:border-line-strong",
  );
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}
