// Process 5 — Query Domain Knowledge
// (query_1 + semantic_frame_1 + knowledge_graph_1) -> [model_1 extract] -> (query_concepts_1)* -> [model_2 translate]
// -> (query_vectors_1)* -> [tool_1 match] -> (query_facts_1)* -> [model_1 generate]~ -> (query_answer_1)
// -> [tool_3 compose] -> (query_cards_1)* -> [tool_3 match] -> (text_card_links_1)*
import { randomUUID } from "node:crypto";
import { callModel } from "./model.ts";
import { embed } from "./embed.ts";
import { frameToPrompt } from "./context.ts";
import { composeQueryCards, linkAnswerToCards } from "./align.ts";
import type { GraphDB } from "./graphdb.ts";
import type { Fact, QueryTurn, SemanticFrame } from "../shared/types.ts";

const EXTRACT_SYSTEM = `A fiction writer asks a question about a domain. Extract the domain concepts needed to answer it (1-6 short noun phrases), using the writing context to disambiguate. Return only concepts, no answer.`;
const EXTRACT_SCHEMA = {
  type: "object",
  properties: { concepts: { type: "array", items: { type: "string" } } },
  required: ["concepts"],
};

/** [model_1 extract]: query + semantic_frame -> query_concepts* */
export async function extractQueryConcepts(query: string, frame: SemanticFrame | null): Promise<string[]> {
  const out = await callModel<{ concepts: string[] }>({
    op: "extract query concepts",
    system: EXTRACT_SYSTEM,
    prompt: `WRITING CONTEXT\n${frameToPrompt(frame)}\n\nQUESTION\n${query}`,
    schema: EXTRACT_SCHEMA,
  });
  return [...new Set((out.concepts ?? []).map((c) => c.trim()).filter(Boolean))].slice(0, 6);
}

const ANSWER_SYSTEM = `You answer a fiction writer's question about a domain, conversationally and concisely (60-180 words).
Use ONLY the source facts provided. If they do not answer the question, say what is known and what is missing.
Name concepts using the same names as in the facts. Do not cite fact numbers (the writer sees the facts as cards next to your answer). Do not write story prose for the writer and do not invent facts.`;
const ANSWER_SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };

/** [model_1 generate]~: query + query_facts* -> query_answer */
export async function generateQueryAnswer(query: string, facts: Fact[]): Promise<string> {
  if (!facts.length) return "I couldn't find anything in the uploaded sources about that. Try rephrasing, or upload a source that covers it.";
  const out = await callModel<{ answer: string }>({
    op: "generate query answer",
    system: ANSWER_SYSTEM,
    prompt: `QUESTION\n${query}\n\nSOURCE FACTS\n${facts.map((f) => `- ${f.statement} — "${f.quote}" (${f.docTitle})`).join("\n")}`,
    schema: ANSWER_SCHEMA,
  });
  const a = (out.answer ?? "").trim();
  if (!a) throw new Error("empty answer");
  return a;
}

export async function queryKnowledge(db: GraphDB, query: string, frame: SemanticFrame | null): Promise<QueryTurn> {
  const turnId = randomUUID().slice(0, 8);
  const names = await extractQueryConcepts(query, frame);
  const concepts = names.map((concept, i) => ({ key: `q${i}`, concept }));
  const vectors = await embed(concepts.map((c) => c.concept)); // [model_2 translate]
  const facts = db.match(concepts.map((c, i) => ({ key: c.key, text: c.concept, vector: vectors[i] })), 2).slice(0, 24); // [tool_1 match], multi-hop
  const answer = await generateQueryAnswer(query, facts);
  const cards = composeQueryCards(turnId, query, concepts, facts); // [tool_3 compose]
  const links = linkAnswerToCards(answer, cards); // [tool_3 match]
  return { id: turnId, query, answer, cards, links, facts, createdAt: new Date().toISOString() };
}
