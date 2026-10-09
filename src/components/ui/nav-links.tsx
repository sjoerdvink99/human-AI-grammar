"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";

const links = [
  { href: "/systems", label: "Systems" },
  { href: "/explore", label: "Explore" },
  { href: "/compare", label: "Compare" },
  { href: "/vocabulary", label: "Vocabulary" },
  { href: "/design", label: "Design" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex h-full items-center gap-5">
      {links.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cx(
              "flex h-full items-center border-b-2 pt-0.5 text-[13px] transition-colors",
              active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
