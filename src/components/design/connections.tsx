import { Fragment } from "react";
import { Identifier } from "@/components/grammar/identifier";
import { Section } from "@/components/ui/section";
import type { Connection } from "@/domain/design/connections";

function Ids({ ids }: { ids: string[] }) {
  return (
    <span className="font-mono text-xs">
      {ids.map((id, index) => (
        <Fragment key={id}>
          {index > 0 && ", "}
          <Identifier name={id} />
        </Fragment>
      ))}
    </span>
  );
}

export function Connections({
  labels,
  notes,
  parsed,
  links,
}: {
  labels: string[];
  notes: string[];
  parsed: boolean[];
  links: Connection[];
}) {
  const unconnected = labels
    .map((label, index) => ({ label, index }))
    .filter(({ index }) => parsed[index] && !notes[index] && !links.some((link) => link.from === index || link.to === index));

  return (
    <Section title="Connections" aside="Derived from shared identifiers and When notes">
      <ul className="divide-y divide-line border-y border-line text-[13px]">
        {links.map((link) => (
          <li key={`${link.kind}:${link.from}:${link.to}`} className="py-2">
            {link.kind === "continues" ? (
              <>
                <span className="font-medium">{labels[link.to]}</span> <span className="text-muted">continues from</span>{" "}
                <span className="font-medium">{labels[link.from]}</span> <span className="text-muted">through</span> <Ids ids={link.via} />
              </>
            ) : (
              <>
                <span className="font-medium">{labels[link.from]}</span> <span className="text-muted">and</span>{" "}
                <span className="font-medium">{labels[link.to]}</span> <span className="text-muted">both work with</span> <Ids ids={link.via} />
              </>
            )}
          </li>
        ))}
        {labels.map(
          (label, index) =>
            notes[index] && (
              <li key={`note:${index}`} className="py-2">
                <span className="font-medium">{label}</span> <span className="text-muted">runs</span> {notes[index]}
              </li>
            ),
        )}
        {unconnected.map(({ label }) => (
          <li key={`alone:${label}`} className="py-2 text-muted">
            <span className="font-medium text-ink">{label}</span> is not connected yet. Start it from a representation another process
            produces, or describe under When how it relates.
          </li>
        ))}
      </ul>
    </Section>
  );
}
