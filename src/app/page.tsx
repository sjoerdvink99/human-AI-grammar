import { Citation } from "@/components/ui/citation";

const resources = [
  { label: "Paper", href: "" },
  { label: "GitHub", href: "https://github.com/sjoerdvink99/human-AI-grammar" },
  { label: "Video", href: "" },
];

const people = [
  { label: "Sjoerd Vink", href: "https://sjoerdvink99.github.io/" },
  { label: "Alexandra Scott", href: "https://scholar.google.com/citations?user=v0v7q6QAAAAJ&hl=en" },
  { label: "Manling Yang", href: "https://scholar.google.com/citations?user=1wQouukAAAAJ&hl=en&oi=ao" },
  { label: "Byungmoo Kim", href: "" },
  { label: "Remco Chang", href: "https://www.cs.tufts.edu/~remco/" },
];

const abstract =
  "Advances in generative AI have expanded the capabilities of interactive systems and the complexity of the processes through which humans and AI interact. This evolution enables new approaches to system design and interaction, while opening up new avenues for research. However, existing approaches provide limited support for systematically describing and comparing the human-AI interaction processes. We introduce a grammar for expressing human-AI processes in systems as transformations between representations. The grammar characterizes representations by their roles and media, and transformations by the actors and operations involved. Through the lens of this grammar, we can systematically describe and compare existing systems and explore alternative interaction designs. We use LLMs to apply the grammar to 160 human–AI systems from the literature, demonstrating how it captures diverse interaction structures within a common framework.";

const plainCitation = "Sjoerd Vink, Alexandra Scott, Manling Yang, Byungmoo Kim, and Remco Chang. 2026. A Grammar for Human-AI Systems.";

const bibtex = `@misc{vink2026grammar,
  title  = {A Grammar for Human-AI Systems},
  author = {Vink, Sjoerd and Scott, Alexandra and Yang, Manling and Kim, Byungmoo and Chang, Remco},
  year   = {2026}
}`;

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
);

const LinkList = ({ links }: { links: { label: string; href: string }[] }) => (
  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[15px]">
    {links.map(({ label, href }, index) => (
      <li key={label} className="flex gap-3">
        {index > 0 && <span className="text-faint" aria-hidden>|</span>}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4 hover:text-accent">
            {label}
          </a>
        ) : (
          <span className="text-faint" title="Coming soon">
            {label}
          </span>
        )}
      </li>
    ))}
  </ul>
);

export default function HomePage() {
  return (
    <div className="max-w-5xl pt-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">A Grammar for Human-AI Systems</h1>
        <p className="mt-1 text-[15px]">Sjoerd Vink, Alexandra Scott, Manling Yang, Byungmoo Kim, Remco Chang</p>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
          A repository for describing, comparing, and exploring Human-AI systems through a common process representation.
        </p>
      </header>

      <div className="mt-12 max-w-3xl space-y-10">
        <section>
          <Heading>Abstract</Heading>
          <p className="text-[15px] leading-relaxed">{abstract}</p>
        </section>

        <section>
          <Heading>Resources</Heading>
          <LinkList links={resources} />
        </section>

        <section>
          <Heading>Reference</Heading>
          <div className="space-y-3">
            <Citation text={plainCitation} format="Plain text" />
            <Citation text={bibtex} format="BibTeX" mono />
          </div>
        </section>

        <section>
          <Heading>People</Heading>
          <LinkList links={people} />
        </section>
      </div>
    </div>
  );
}
