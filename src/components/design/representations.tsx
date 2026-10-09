import { Fragment } from "react";
import { Identifier } from "@/components/grammar/identifier";
import { Section } from "@/components/ui/section";
import type { NamedRepresentation } from "@/domain/design/spec";

export function Representations({
  named,
  descriptions,
  onChange,
}: {
  named: NamedRepresentation[];
  descriptions: Record<string, string>;
  onChange: (name: string, description: string) => void;
}) {
  if (named.length === 0) return null;
  return (
    <Section title="Representations" aside="What each one contains, shared across versions and processes">
      <ul className="divide-y divide-line border-y border-line">
        {named.map(({ name, ids, types }) => (
          <li key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-4 py-1.5">
            <span className="truncate text-xs">
              <span className="font-mono">
                {ids.map((id, index) => (
                  <Fragment key={id}>
                    {index > 0 && ", "}
                    <Identifier name={id} />
                  </Fragment>
                ))}
              </span>
              <span className="ml-2 text-faint">{types.join(" · ")}</span>
            </span>
            <input
              value={descriptions[name] ?? ""}
              onChange={(event) => onChange(name, event.target.value)}
              placeholder={types[0]?.startsWith("instruction") ? "e.g. a request naming an animal and a mood" : "e.g. a short illustrated story, only about cats or dogs"}
              className="h-7 w-full bg-transparent text-[13px] placeholder:text-faint focus:outline-none"
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}
