import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, GitCompare } from "lucide-react";
import { Identifier } from "@/components/grammar/identifier";
import { Overview } from "@/components/grammar/overview";
import { ProcessFlow } from "@/components/grammar/process-flow";
import { StructureSummary } from "@/components/grammar/structure-summary";
import { VocabularyUsage } from "@/components/grammar/vocabulary-usage";
import { buttonClass } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Tag } from "@/components/ui/tag";
import { listSystems } from "@/db/queries";
import { processGraph } from "@/domain/grammar/graph";
import { describeActor } from "@/domain/systems/actors";
import { flow } from "@/domain/systems/flow";
import { formatAuthors, processAnchor, processNumber, shortAuthors } from "@/lib/format";
import { systemsHref } from "@/lib/query-params";
import { loadEntry } from "@/lib/repository";
import { screenshotFor } from "@/lib/screenshots";

interface Props {
  params: Promise<{ id: string }>;
}

function Screenshot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export serves screenshots unoptimized */}
      <img src={src} alt={alt} className="w-full rounded border border-line" />
      <figcaption className="mt-1.5 text-xs text-faint">{caption}</figcaption>
    </figure>
  );
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
  const names = entry.processes.map(({ name }) => name);
  const processFlow = flow(entry.processes.map(({ result }) => (result.ok ? result.process : null)));
  const ref = (index: number, via?: string[]) => ({
    anchor: processAnchor(index),
    label: processNumber(index),
    name: names[index] ?? undefined,
    via,
  });
  const graphs = entry.processes.flatMap(({ name, description, result }, index) =>
    result.ok
      ? [
          {
            label: `${processNumber(index)}${name ? ` ${name}` : ""}`,
            place: processNumber(index),
            anchor: processAnchor(index),
            description,
            relations: {
              from: processFlow.dependencies.filter((dep) => dep.to === index).map((dep) => ref(dep.from, dep.via)),
              to: processFlow.dependencies.filter((dep) => dep.from === index).map((dep) => ref(dep.to)),
            },
            process: result.process,
            graph: processGraph([result.process]),
          },
        ]
      : [],
  );
  const link = paper.doi ? `https://doi.org/${paper.doi}` : paper.url;
  const [screenshot, ...moreScreenshots] = screenshotFor(paper.citationKey);
  const caption = `${entry.name} as presented in ${shortAuthors(paper.authors)} (${paper.year}).`;

  return (
    <article>
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

      <div className="mt-5 grid grid-cols-[1fr_18rem] gap-10">
        <div className="min-w-0 space-y-6">
          {screenshot && <Screenshot src={screenshot} alt={`Screenshot 1 of ${entry.name}`} caption={caption} />}
          <p className="text-[14px] leading-relaxed">{entry.description || <span className="text-faint">No description.</span>}</p>
        </div>
        <dl className="space-y-2 text-[13px]">
          <div>
            <dt className="text-xs text-muted">Process scope</dt>
            <dd>{entry.processScope ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Citation key</dt>
            <dd className="font-mono text-xs">{paper.citationKey}</dd>
          </div>
          {Object.keys(entry.actors).length > 0 && (
            <div>
              <dt className="mb-1 text-xs text-muted">Models and tools</dt>
              <dd>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[12px] leading-5">
                  {Object.entries(entry.actors)
                    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
                    .map(([actor, details]) => (
                    <Fragment key={actor}>
                      <dt className="font-mono text-accent">
                        <Identifier name={actor} />
                      </dt>
                      <dd className="text-muted">{describeActor(details)}</dd>
                    </Fragment>
                  ))}
                </dl>
              </dd>
            </div>
          )}
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

      <ProcessFlow flow={processFlow} names={names} />

      <Overview title="Grammar processes" graphs={graphs} actors={entry.actors} exportName={paper.citationKey} />

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

      {moreScreenshots.length > 0 && (
        <Section title="Screenshots">
          <div className="grid grid-cols-[1fr_18rem] gap-10">
            <div className="min-w-0 space-y-6">
              {moreScreenshots.map((src, index) => (
                <Screenshot key={src} src={src} alt={`Screenshot ${index + 2} of ${entry.name}`} caption={caption} />
              ))}
            </div>
          </div>
        </Section>
      )}
    </article>
  );
}
