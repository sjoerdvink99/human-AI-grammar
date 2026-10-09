import type { Metadata } from "next";
import Link from "next/link";
import { Expression } from "@/components/grammar/expression";
import { GrammarDefinition } from "@/components/grammar/grammar-definition";
import { Identifier } from "@/components/grammar/identifier";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { parseProcess } from "@/domain/grammar/parser";

export const metadata: Metadata = { title: "Grammar" };

const notation = [
  { form: "(id: role medium)", meaning: "a representation: a typed piece of information" },
  { form: "a + b", meaning: "representations present together in one state" },
  { form: "[actor op]", meaning: "a transformation performed by a human, model, or tool" },
  { form: "[…]~", meaning: "a stochastic transformation" },
  { form: "| …", meaning: "an open vocabulary: listed terms are seeds, new terms are allowed" },
];

const example = `(prompt_1: instruction language)
-> [model generate]~
-> (draft_1: artifact language)
-> [human select]
-> (draft_1: artifact language) + (region_1: selection spatial)`;

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
);

export default function GrammarPage() {
  const parsed = parseProcess(example);

  return (
    <>
      <PageHeader
        title="Grammar"
        description="A Human-AI system is described as processes: states of typed representations connected by transformations performed by humans, models, and tools."
      />

      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-14">
        <section>
          <Heading>Definition</Heading>
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

      {parsed.ok && (
        <Section title="Example">
          <div className="border-y border-line py-4">
            <Expression process={parsed.process} />
          </div>
          <p className="mt-3 text-[13px] text-muted">
            A user writes a prompt, a model generates a draft, and the user selects a region of the draft. The terms in use across the corpus are listed under{" "}
            <Link href="/vocabulary" className="text-accent hover:underline">
              Vocabulary
            </Link>
            .
          </p>
        </Section>
      )}
    </>
  );
}
