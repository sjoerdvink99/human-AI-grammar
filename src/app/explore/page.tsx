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
        description="Read the structure of the corpus: who acts in each process, which sequences recur, how representations flow between actors, and which combinations no system uses yet."
      />
      {entries.length > 0 ? (
        <Suspense>
          <Explorer entries={entries} />
        </Suspense>
      ) : <EmptyState title="No systems to plot yet" />}
    </>
  );
}
