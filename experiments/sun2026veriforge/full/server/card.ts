// Process 4 — Inspect Highlighted Knowledge
// (clicked_span_1 + candidate_facts_1*) -> [model_1 generate]~ -> (card_explanation_1) -> [tool_3 compose] -> (highlight_card_1)
import { callModel } from "./model.ts";
import { composeHighlightCard } from "./align.ts";
import type { Fact, HighlightSpan, KnowledgeCard } from "../shared/types.ts";

const SYSTEM = `You explain a domain concept to a fiction writer who highlighted it in their draft.
Write a short, concrete explanation (40-90 words) of the concept, using ONLY the provided source facts.
Focus on what a writer needs to depict it accurately (what it is, how it works or looks, period/context details).
Do not write story prose and do not suggest edits to the draft.`;

const SCHEMA = { type: "object", properties: { explanation: { type: "string" } }, required: ["explanation"] };

/** [model_1 generate]~ */
export async function generateCardExplanation(span: HighlightSpan, facts: Fact[]): Promise<string> {
  const own = facts.filter((f) => span.factIds.includes(f.id));
  const out = await callModel<{ explanation: string }>({
    op: "generate card explanation",
    system: SYSTEM,
    prompt: `Highlighted phrase: "${span.text}" (concept: ${span.concept})\n\nSource facts:\n${own
      .map((f, i) => `${i + 1}. ${f.statement}\n   Source (${f.docTitle}): "${f.quote}"`)
      .join("\n")}`,
    schema: SCHEMA,
  });
  const text = (out.explanation ?? "").trim();
  if (!text) throw new Error("empty explanation");
  return text.split(/\s+/).slice(0, 120).join(" ");
}

export async function inspectHighlight(draft: string, span: HighlightSpan, facts: Fact[]): Promise<KnowledgeCard> {
  const explanation = await generateCardExplanation(span, facts);
  return composeHighlightCard(draft, span, explanation, facts); // [tool_3 compose]
}
