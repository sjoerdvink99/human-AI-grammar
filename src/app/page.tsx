import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Citation } from "@/components/ui/citation";
import { buildVocabulary } from "@/domain/systems/vocabulary";
import { loadEntries } from "@/lib/repository";

const entryPoints = [
  { href: "/grammar", title: "Read the grammar", description: "The definition, notation, and a worked example." },
  { href: "/systems", title: "Browse systems", description: "The corpus as a searchable, filterable table." },
  { href: "/explore", title: "Explore corpus", description: "Structural features plotted against each other." },
  { href: "/compare", title: "Compare systems", description: "Side-by-side structure and similarity for 2–4 systems." },
  { href: "/design", title: "Design a system", description: "Compose your own expression from corpus steps and implement it with Claude Code." },
];

const abstract =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.";

const bibtex = `@misc{vink2026grammar,
  title  = {A Grammar for Human-AI Systems},
  author = {Vink, Sjoerd},
  year   = {2026}
}`;

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

      <div className="mt-12 grid grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-14">
        <section>
          <Heading>Abstract</Heading>
          <p className="text-[14px] leading-relaxed">{abstract}</p>
        </section>

        <section>
          <Heading>Cite</Heading>
          <Citation bibtex={bibtex} />
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
