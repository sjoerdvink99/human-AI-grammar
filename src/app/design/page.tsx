import type { Metadata } from "next";
import { Suspense } from "react";
import { Designer } from "@/components/design/designer";
import { PageHeader } from "@/components/ui/page-header";
import { loadKnownVocabulary } from "@/lib/known-vocabulary";
import { loadEntries } from "@/lib/repository";

export const metadata: Metadata = { title: "Design" };

export default function DesignPage() {
  return (
    <>
      <PageHeader
        title="Design"
        description="Compose grammar processes for a new system, borrowing steps from the corpus, then implement the design with the Claude Code plugin."
      />
      <Suspense>
        <Designer entries={loadEntries()} known={loadKnownVocabulary()} />
      </Suspense>
    </>
  );
}
