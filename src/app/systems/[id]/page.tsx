import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, GitCompare } from "lucide-react";
import { Overview } from "@/components/grammar/overview";
import { StructureSummary } from "@/components/grammar/structure-summary";
import { VocabularyUsage } from "@/components/grammar/vocabulary-usage";
import { buttonClass } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Tag } from "@/components/ui/tag";
import { listSystems } from "@/db/queries";
import { processGraph } from "@/domain/grammar/graph";
import { formatAuthors } from "@/lib/format";
import { systemsHref } from "@/lib/query-params";
import { loadEntry } from "@/lib/repository";

interface Props {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return listSystems().map((system) => ({ id: String(system.id) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = loadEntry(Number((await params).id));
  return { title: entry?.name ?? "System not found" };
}

export default async function SystemPage({ params }: Props) {
  const entry = loadEntry(Number((await params).id));
  if (!entry) notFound();
  const { paper } = entry;
  const graphs = entry.processes.flatMap(({ name, result }, index) =>
    result.ok
      ? [{ label: `${String(index + 1).padStart(2, "0")}${name ? ` ${name}` : ""}`, process: result.process, graph: processGraph([result.process]) }]
      : [],
  );
  const link = paper.doi ? `https://doi.org/${paper.doi}` : paper.url;

  return (
    <article className="max-w-4xl">
      <header className="flex items-start justify-between gap-8 border-b border-line pb-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{entry.name}</h1>
          <p className="mt-1 text-[14px]">{paper.title}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            {formatAuthors(paper.authors, 6)} · {paper.venue} {paper.year}
            {link && (
              <>
                {" · "}
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                  {paper.doi ?? "Link"}
                  <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </p>
        </div>
        <Link href={`/compare?ids=${entry.id}`} className={buttonClass("ghost", "shrink-0")}>
          <GitCompare className="size-3.5" />
          Compare
        </Link>
      </header>

      <div className="mt-5 grid grid-cols-[1fr_15rem] gap-10">
        <p className="text-[14px] leading-relaxed">{entry.description || <span className="text-faint">No description.</span>}</p>
        <dl className="space-y-2 text-[13px]">
          <div>
            <dt className="text-xs text-muted">Process scope</dt>
            <dd>{entry.processScope ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Citation key</dt>
            <dd className="font-mono text-xs">{paper.citationKey}</dd>
          </div>
          {paper.tags.length > 0 && (
            <div>
              <dt className="mb-1 text-xs text-muted">Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {paper.tags.map((tag) => (
                  <Tag key={tag} href={systemsHref({ q: tag })}>
                    {tag}
                  </Tag>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <Overview title="Grammar processes" graphs={graphs} />

      <Section title="Structure" aside="Derived from the parsed processes">
        <StructureSummary features={entry.features} />
      </Section>

      <Section title="Vocabulary">
        <VocabularyUsage features={entry.features} />
      </Section>

      {(paper.abstract || paper.notes || entry.notes) && (
        <Section title="Notes">
          <div className="space-y-3 text-[13px] leading-relaxed text-muted">
            {paper.abstract && <p>{paper.abstract}</p>}
            {paper.notes && <p>{paper.notes}</p>}
            {entry.notes && <p>{entry.notes}</p>}
          </div>
        </Section>
      )}
    </article>
  );
}
