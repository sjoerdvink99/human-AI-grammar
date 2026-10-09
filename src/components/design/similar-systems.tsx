import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import type { SimilarSystem } from "@/domain/design/inspiration";
import { formatScore, shortAuthors } from "@/lib/format";

export function SimilarSystems({
  similar,
  references,
  onReference,
}: {
  similar: SimilarSystem[];
  references: string[];
  onReference: (citationKey: string) => void;
}) {
  if (similar.length === 0) return null;
  return (
    <Section title="Similar systems" aside="Structural similarity, as in Compare">
      <ul className="divide-y divide-line border-y border-line">
        {similar.map(({ entry, similarity }) => {
          const referenced = references.includes(entry.paper.citationKey);
          return (
            <li key={entry.id} className="grid grid-cols-[1fr_3rem_6rem] items-center gap-4 py-2">
              <div className="min-w-0 truncate text-[13px]">
                <Link href={`/systems/${entry.id}`} className="font-medium hover:text-accent">
                  {entry.name}
                </Link>
                <span className="text-muted">
                  {" "}
                  · {shortAuthors(entry.paper.authors)}, {entry.paper.venue} {entry.paper.year}
                </span>
              </div>
              <span className="text-right text-[13px] tabular-nums">{formatScore(similarity.overall)}</span>
              <Button variant="ghost" disabled={referenced} onClick={() => onReference(entry.paper.citationKey)} className="justify-self-end">
                {referenced ? "Referenced" : "Reference"}
              </Button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
