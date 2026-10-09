import type { Metadata } from "next";
import { Suspense } from "react";
import { Explorer } from "@/components/explore/explorer";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { loadEntries } from "@/lib/repository";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  const entries = loadEntries();
  return (
    <>
      <PageHeader
        title="Explore"
        description="Compare systems by the structural dimensions derived from their grammar processes, see how the corpus is composed, or follow how processes branch out from a shared starting representation."
      />
      {entries.length > 0 ? (
        <Suspense>
          <Explorer entries={entries} />
        </Suspense>
      ) : <EmptyState title="No systems to plot yet" />}
    </>
  );
}
