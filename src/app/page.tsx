import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GrammarDefinition } from "@/components/grammar/grammar-definition";
import { Identifier } from "@/components/grammar/identifier";
import { buildVocabulary } from "@/domain/systems/vocabulary";
import { loadEntries } from "@/lib/repository";

const entryPoints = [
  { href: "/systems", title: "Browse systems", description: "The corpus as a searchable, filterable table." },
  { href: "/explore", title: "Explore corpus", description: "Structural features plotted against each other." },
  { href: "/compare", title: "Compare systems", description: "Side-by-side structure and similarity for 2–4 systems." },
  { href: "/design", title: "Design a system", description: "Compose your own expression from corpus steps and implement it with Claude Code." },
];

const notation = [
  { form: "(id: role medium)", meaning: "a representation: a typed piece of information" },
  { form: "a + b", meaning: "representations present together in one state" },
  { form: "[actor op]", meaning: "a transformation performed by a human, model, or tool" },
  { form: "[…]~", meaning: "a stochastic transformation" },
  { form: "| …", meaning: "an open vocabulary: listed terms are seeds, new terms are allowed" },
];

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
);

export default function HomePage() {
  const entries = loadEntries();
  const stats = [
    { label: "systems", value: entries.length },
    { label: "papers", value: new Set(entries.map((entry) => entry.paper.id)).size },
    { label: "grammar processes", value: entries.reduce((sum, entry) => sum + entry.processes.length, 0) },
    { label: "vocabulary terms", value: buildVocabulary(entries).length },
  ];

  return (
    <div className="max-w-5xl pt-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">A Grammar for Human-AI Systems</h1>
        <p className="mt-1 text-[15px]">Sjoerd Vink</p>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
          A repository for describing, comparing, and exploring Human-AI systems through a common process representation.
        </p>
      </header>

      <div className="mt-12 grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-14">
        <section>
          <Heading>Grammar</Heading>
          <GrammarDefinition />
        </section>

        <section>
          <Heading>Notation</Heading>
          <dl className="space-y-1 text-[13px] leading-6">
            {notation.map(({ form, meaning }) => (
              <div key={form} className="grid grid-cols-[9.5rem_1fr] gap-3">
                <dt className="font-mono">{form}</dt>
                <dd className="text-muted">{meaning}</dd>
              </div>
            ))}
            <div className="grid grid-cols-[9.5rem_1fr] gap-3">
              <dt className="font-mono">
                <Identifier name="model_1" />
              </dt>
              <dd className="text-muted">an actor instance; identifiers carry subscript indices</dd>
            </div>
          </dl>
        </section>
      </div>

      <nav className="mt-12 max-w-3xl divide-y divide-line border-y border-line">
        {entryPoints.map(({ href, title, description }) => (
          <Link key={href} href={href} className="group flex items-center gap-4 py-3.5">
            <span className="w-40 text-[14px] font-medium group-hover:text-accent">{title}</span>
            <span className="flex-1 text-[13px] text-muted">{description}</span>
            <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
          </Link>
        ))}
      </nav>

      <dl className="mt-8 flex gap-10">
        {stats.map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-xl font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
