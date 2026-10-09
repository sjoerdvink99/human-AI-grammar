import { Fragment } from "react";
import { grammarRules } from "@/domain/grammar/reference";

const symbols = new Set([...grammarRules.map((rule) => rule.symbol), "id"]);

function Sequence({ text }: { text: string }) {
  return text.split(/("[^"]*"|\s+)/).map((part, index) => {
    if (part.startsWith('"')) return <span key={index} className="text-accent">{part.slice(1, -1)}</span>;
    if (symbols.has(part)) return <span key={index} className="italic">{part}</span>;
    return <span key={index} className="text-faint">{part}</span>;
  });
}

function Definition({ text }: { text: string }) {
  const alternatives = text.split(" | ");
  const open = alternatives.at(-1) === "…";
  const terms = open ? alternatives.slice(0, -1) : alternatives;
  return terms.map((alternative, index) => {
    const last = index === terms.length - 1;
    return (
      <Fragment key={index}>
        <span className="whitespace-nowrap">
          <Sequence text={alternative} />
          {(!last || open) && <span className="text-faint"> |</span>}
          {last && open && <span className="text-faint"> …</span>}
        </span>{" "}
      </Fragment>
    );
  });
}

export function GrammarDefinition() {
  return (
    <dl className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-1 font-mono text-[13px] leading-6">
      {grammarRules.map((rule) => (
        <Fragment key={rule.symbol}>
          <dt className="italic">{rule.symbol}</dt>
          <span className="text-faint">::=</span>
          <dd>
            <Definition text={rule.definition} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
