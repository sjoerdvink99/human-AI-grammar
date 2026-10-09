import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { vocabularyTypes, type VocabularyType } from "@/domain/grammar/vocabulary";
import { buildVocabulary } from "@/domain/systems/vocabulary";
import { systemsHref } from "@/lib/query-params";
import { loadEntries } from "@/lib/repository";

export const metadata: Metadata = { title: "Vocabulary" };

const headings: Record<VocabularyType, { title: string; param: string }> = {
  role: { title: "Roles", param: "role" },
  medium: { title: "Media", param: "medium" },
  operation: { title: "Operations", param: "op" },
};

export default function VocabularyPage() {
  const entries = loadEntries();
  const vocabulary = buildVocabulary(entries);

  return (
    <>
      <PageHeader
        title="Vocabulary"
        description="Roles, media, and operations observed in stored expressions. The vocabulary is open: new terms appear here as soon as an expression uses them."
      />
      {vocabulary.length === 0 ? (
        <EmptyState title="No vocabulary observed yet">Terms appear once systems with grammar processes are added.</EmptyState>
      ) : (
        <div className="grid grid-cols-3 gap-10">
          {vocabularyTypes.map((type) => {
            const terms = vocabulary.filter((term) => term.type === type);
            const max = Math.max(...terms.map((term) => term.systemCount), 1);
            return (
              <section key={type}>
                <div className="mb-2 flex items-baseline justify-between border-b border-line-strong pb-2">
                  <h2 className="text-[13px] font-semibold">{headings[type].title}</h2>
                  <span className="text-xs text-faint">systems</span>
                </div>
                <ul>
                  {terms.map((term) => (
                    <li key={term.term}>
                      <Link
                        href={systemsHref({ [headings[type].param]: term.term })}
                        className="group grid grid-cols-[1fr_4rem_1.5rem] items-center gap-3 border-b border-line py-1.5"
                      >
                        <span className="truncate font-mono text-[13px] group-hover:text-accent">
                          {term.term}
                        </span>
                        <span className="h-1.5 rounded-sm bg-wash">
                          <span
                            className="block h-full rounded-sm bg-accent/60"
                            style={{ width: `${(term.systemCount / max) * 100}%` }}
                          />
                        </span>
                        <span className="text-right text-[13px] tabular-nums">{term.systemCount}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
