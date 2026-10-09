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
  { form: "(…)*", meaning: "a collection: many items of the same kind" },
  { form: "[actor op]", meaning: "a transformation performed by a human, model, or tool" },
  { form: "[…]~", meaning: "a generative transformation: it creates new content" },
  { form: "… -> (id_1)", meaning: "a loop: a step that ends in an earlier state goes back to it" },
  { form: "=(id)", meaning: "shorthand in displayed expressions: carried over unchanged from the previous state" },
  { form: "| …", meaning: "an open vocabulary: listed terms are seeds, new terms are allowed" },
];

const examples = [
  {
    title: "Generate and choose",
    text: "A model writes several drafts from the user's prompt, and the user picks one.",
    expression: `(prompt_1: instruction language)
-> [model generate]~
-> (drafts_1: artifact language)*
-> [human select]
-> (draft_1: artifact language)`,
  },
  {
    title: "Loop",
    text: "A model draws an image and the user rewrites the prompt. Ending in prompt_1 sends the process back to its start, so it repeats until the user stops.",
    expression: `(prompt_1: instruction language)
-> [model generate]~
-> (image_1: artifact visual)
-> [human modify]
-> (prompt_1: instruction language)`,
  },
];

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
);

export default function GrammarPage() {
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

      <Section
        title="Examples"
        aside={
          <>
            Terms in use across the corpus are listed under{" "}
            <Link href="/vocabulary" className="text-accent hover:underline">
              Vocabulary
            </Link>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-14 gap-y-8 border-t border-line pt-5">
          {examples.map(({ title, text, expression }) => {
            const parsed = parseProcess(expression);
            return (
              <div key={title}>
                <h3 className="text-[13px] font-medium">{title}</h3>
                <p className="mt-1 mb-3 text-[13px] text-muted">{text}</p>
                {parsed.ok && <Expression process={parsed.process} />}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
