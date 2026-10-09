import type { Metadata } from "next";
import { Suspense } from "react";
import { SystemsBrowser } from "@/components/systems/systems-browser";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { loadEntries } from "@/lib/repository";

export const metadata: Metadata = { title: "Systems" };

export default function SystemsPage() {
  const entries = loadEntries();
  return (
    <>
      <PageHeader
        title="Systems"
        description="Every system in the corpus with structure derived from its grammar processes."
      />
      {entries.length > 0 ? (
        <Suspense>
          <SystemsBrowser entries={entries} />
        </Suspense>
      ) : (
        <EmptyState title="The repository is empty">
          Add a system or run <code className="font-mono">npm run db:seed</code> to load example systems.
        </EmptyState>
      )}
    </>
  );
}
