import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareView } from "@/components/compare/compare-view";
import { PageHeader } from "@/components/ui/page-header";
import { loadEntries } from "@/lib/repository";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return (
    <>
      <PageHeader
        title="Compare"
        description="Structural differences between 2–4 systems, derived from their parsed grammar processes."
      />
      <Suspense>
        <CompareView entries={loadEntries()} />
      </Suspense>
    </>
  );
}
