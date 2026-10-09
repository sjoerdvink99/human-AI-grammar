"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavLinks } from "./nav-links";

export function SiteHeader() {
  if (usePathname().startsWith("/experiment")) return null;
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-12 w-full max-w-[1240px] items-center justify-between gap-8 px-6">
        <Link href="/" className="text-[13px] font-semibold tracking-tight">
          Human-AI Systems Repository
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
