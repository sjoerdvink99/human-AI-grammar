// Model steps of each process, plus the server-side pipelines that chain them with tools.
import { callModel } from "./model";
import {
  composeAnswerFacts,
  composeKnowledgeGraph,
  composeSuggestionCard,
  edgeFactText,
  findSpan,
  matchFactSources,
  matchVectorsToFacts,
  matchVectorsToGraph,
  nodeFactText,
  selectGroundedSpans,
} from "../src/shared/tools";
import type {
  AskResponse,
  BuildGraphResponse,
  DraftClaim,
  DraftContext,
  Entity,
  GroundResponse,
  Grounding,
  ItemVector,
  KGFact,
  KnowledgeGraph,
  QueryTerm,
  Relation,
  SourceDocument,
  SuggestResponse,
  TextSpan,
} from "../src/shared/types";

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const str = { type: "string" } as const;

// ================================================================ P1
/** P1 · [model_1 extract]: r1* → r2* + r3* */
export async function extractEntitiesAndRelations(docs: SourceDocument[]) {
  const results = await mapLimit(docs, 3, async (doc) => {
    const res = await callModel<{
      entities: { name: string; type: string; description: string }[];
      relations: { source: string; label: string; target: string; evidence: string }[];
    }>({
      role: "model_1",
      op: "P1 extract",
      system:
        "You build knowledge graphs from documents. Extract the important entities (people, organisations, " +
        "places, concepts, methods, phenomena, measurements, events) and the factual relations between them " +
        "that the document states. Use short canonical entity names (singular, no articles). Relation labels " +
        "are short lowercase verb phrases. Every relation's source and target must be an extracted entity name, " +
        "and its evidence must be a verbatim sentence or clause from the document. Do not add outside knowledge.",
      prompt: `Document title: ${doc.title}\n\nDocument text:\n"""\n${doc.text}\n"""`,
      schema: {
        type: "object",
        properties: {
          entities: {
            type: "array",
            items: { type: "object", properties: { name: str, type: str, description: str }, required: ["name", "type", "description"] },
          },
          relations: {
            type: "array",
            items: {
              type: "object",
              properties: { source: str, label: str, target: str, evidence: str },
              required: ["source", "label", "target", "evidence"],
            },
          },
        },
        required: ["entities", "relations"],
      },
    });
    const entities: Entity[] = (res.entities ?? [])
      .filter((e) => e.name?.trim())
      .map((e) => ({ name: e.name.trim(), type: (e.type || "concept").toLowerCase(), description: e.description ?? "", docId: doc.id }));
    const relations: Relation[] = (res.relations ?? [])
      .filter((r) => r.source?.trim() && r.target?.trim() && r.label?.trim())
      // validation: evidence must come from the document; otherwise keep the relation without evidence
      .map((r) => ({ ...r, evidence: r.evidence && findSpan(doc.text, r.evidence) ? r.evidence : "", docId: doc.id }));
    return { entities, relations };
  });
  return { entities: results.flatMap((r) => r.entities), relations: results.flatMap((r) => r.relations) };
}

export async function buildGraph(docs: SourceDocument[]): Promise<BuildGraphResponse> {
  const { entities, relations } = await extractEntitiesAndRelations(docs);
  const knowledgeGraph = composeKnowledgeGraph(entities, relations); // P1 · [tool_1 compose]
  return { entities, relations, knowledgeGraph };
}

// ================================================================ model_2
const BATCH = 100;
/** P3, P5 · [model_2 translate]: text items + r4 → numeric relevance vectors over KG nodes (r9*, r17*) */
export async function translateToVectors(items: { id: string; text: string }[], kg: KnowledgeGraph): Promise<ItemVector[]> {
  const vectors: ItemVector[] = items.map((it) => ({ itemId: it.id, scores: new Array(kg.nodes.length).fill(0) }));
  if (!items.length || !kg.nodes.length) return vectors;
  const batches: number[] = [];
  for (let s = 0; s < kg.nodes.length; s += BATCH) batches.push(s);
  await mapLimit(batches, 3, async (start) => {
    const slice = kg.nodes.slice(start, start + BATCH);
    const res = await callModel<{ vectors: { itemId: string; scores: { node: number; score: number }[] }[] }>({
      role: "model_2",
      op: "translate",
      system:
        "You map text items into a semantic space whose axes are knowledge-graph nodes. For every item, give a " +
        "relevance score between 0 and 1 for each node the item is about or directly relies on (1 = the item is " +
        "about exactly this node, 0.5 = clearly related, below 0.3 = omit). Omit unrelated nodes. Be consistent " +
        "and calibrated.",
      prompt:
        `Knowledge-graph nodes (index: name — type — description):\n` +
        slice.map((n, i) => `${i}: ${n.name} — ${n.type} — ${n.description}`).join("\n") +
        `\n\nItems:\n` +
        items.map((it) => `${it.id}: ${it.text}`).join("\n"),
      schema: {
        type: "object",
        properties: {
          vectors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                itemId: str,
                scores: {
                  type: "array",
                  items: { type: "object", properties: { node: { type: "integer" }, score: { type: "number" } }, required: ["node", "score"] },
                },
              },
              required: ["itemId", "scores"],
            },
          },
        },
        required: ["vectors"],
      },
    });
    for (const v of res.vectors ?? []) {
      const target = vectors.find((x) => x.itemId === v.itemId);
      if (!target) continue;
      for (const { node, score } of v.scores ?? []) {
        if (Number.isInteger(node) && node >= 0 && node < slice.length && Number.isFinite(score))
          target.scores[start + node] = Math.max(0, Math.min(1, score));
      }
    }
  });
  return vectors;
}

// ================================================================ P3
/** P3 · [model_1 extract]: r5 + r7 + r4 → r8* */
export async function extractDraftClaims(draft: string, context: DraftContext, kg: KnowledgeGraph): Promise<DraftClaim[]> {
  const res = await callModel<{ claims: { quote: string; kind: "claim" | "concept" }[] }>({
    role: "model_1",
    op: "P3 extract",
    system:
      "You read a writer's draft and extract the factual claims and key domain concepts it contains, so they " +
      "can be checked against a knowledge graph. Each item's quote must be copied verbatim from the draft " +
      "(a clause or sentence for claims, a short phrase for concepts). Prefer items related to the knowledge " +
      "graph's topics and to the writer's map concepts. Return at most 15 items, without overlaps.",
    prompt:
      `Draft paragraphs (${context.wordCount} words):\n` +
      context.paragraphs.map((p) => `[${p.index}] ${p.text}`).join("\n") +
      `\n\nWriter's map concepts: ${context.mapConcepts.join("; ") || "(none)"}` +
      `\n\nKnowledge-graph topics: ${kg.nodes.slice(0, 150).map((n) => n.name).join("; ")}`,
    schema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          items: { type: "object", properties: { quote: str, kind: { type: "string", enum: ["claim", "concept"] } }, required: ["quote", "kind"] },
        },
      },
      required: ["claims"],
    },
  });
  // validation: keep only quotes that are actually in the draft
  return (res.claims ?? [])
    .filter((c) => c.quote && findSpan(draft, c.quote))
    .slice(0, 15)
    .map((c, i) => ({ id: `c${i + 1}`, quote: c.quote.trim(), kind: c.kind === "concept" ? "concept" : "claim" }));
}

export async function groundDraft(draft: string, context: DraftContext, kg: KnowledgeGraph): Promise<GroundResponse> {
  const draftClaims = await extractDraftClaims(draft, context, kg);
  const claimVectors = await translateToVectors(draftClaims.map((c) => ({ id: c.id, text: c.quote })), kg);
  const groundings = matchVectorsToGraph(draftClaims, claimVectors, kg); // P3 · [tool_1 match]
  const groundedSpans = selectGroundedSpans(draft, groundings); // P3 · [tool_3 select]
  return { draftClaims, claimVectors, groundings, groundedSpans };
}

// ================================================================ P4
/** P4 · [model_1 generate]~: r12 + r10* → r13 */
export async function generateSuggestion(span: TextSpan, groundings: Grounding[], kg: KnowledgeGraph): Promise<string> {
  const g = groundings.find((x) => x.claimId === span.refId);
  const facts = g
    ? [
        ...g.matches.map((m) => kg.nodes.find((n) => n.id === m.nodeId)).filter(Boolean).map((n) => nodeFactText(n!)),
        ...g.edgeIds.map((id) => kg.edges.find((e) => e.id === id)).filter(Boolean).map((e) => edgeFactText(e!, kg)),
      ]
    : [];
  const res = await callModel<{ suggestion: string }>({
    role: "model_1",
    op: "P4 generate",
    system:
      "You help a writer ground their text in source material. Given a passage the writer selected and the " +
      "knowledge-graph facts it matched, write a suggestion: a revised or extended version of the passage " +
      "(1–3 sentences) that corrects anything the facts contradict and adds the most useful supporting detail " +
      "from the facts. Use only the given facts; keep the writer's voice.",
    prompt: `Selected passage:\n"${span.text}"\n\nMatched facts:\n${facts.map((f) => "- " + f).join("\n") || "(none)"}`,
    schema: { type: "object", properties: { suggestion: str }, required: ["suggestion"] },
  });
  if (!res.suggestion?.trim()) throw new Error("The model returned an empty suggestion");
  return res.suggestion.trim();
}

export async function suggest(span: TextSpan, groundings: Grounding[], kg: KnowledgeGraph): Promise<SuggestResponse> {
  const suggestion = await generateSuggestion(span, groundings, kg);
  const suggestionCard = composeSuggestionCard(span, suggestion, groundings); // P4 · [tool_3 compose]
  return { suggestion, suggestionCard };
}

// ================================================================ P5
/** P5 · [model_1 extract]: r15 + r7 + r4 → r16* */
export async function extractQuestionTerms(question: string, context: DraftContext, kg: KnowledgeGraph): Promise<QueryTerm[]> {
  const res = await callModel<{ terms: string[] }>({
    role: "model_1",
    op: "P5 extract",
    system:
      "You turn a writer's question into the key concepts needed to look it up in a knowledge graph. Resolve " +
      "references such as 'this' or 'my argument' using the draft context. Return 1–6 short concept phrases.",
    prompt:
      `Question: ${question}\n\nDraft context — map concepts: ${context.mapConcepts.join("; ") || "(none)"}\n` +
      `Draft opening: ${context.paragraphs.slice(0, 3).map((p) => p.text).join(" ").slice(0, 1200)}\n\n` +
      `Knowledge-graph topics: ${kg.nodes.slice(0, 150).map((n) => n.name).join("; ")}`,
    schema: { type: "object", properties: { terms: { type: "array", items: str } }, required: ["terms"] },
  });
  return (res.terms ?? []).filter((t) => t.trim()).slice(0, 6).map((t, i) => ({ id: `q${i + 1}`, text: t.trim() }));
}

/** P5 · [model_1 generate]~: r18* + r15 → r19 */
export async function generateAnswer(question: string, facts: KGFact[]): Promise<string> {
  const res = await callModel<{ answer: string }>({
    role: "model_1",
    op: "P5 generate",
    system:
      "You answer a writer's question using only the numbered knowledge-graph facts provided. Cite facts inline " +
      "as [F1], [F2] after the sentence they support. If the facts do not answer the question, say so briefly. " +
      "Keep the answer under 150 words.",
    prompt: `Question: ${question}\n\nFacts:\n${facts.map((f) => `[${f.id}] ${f.text}`).join("\n") || "(no matching facts)"}`,
    schema: { type: "object", properties: { answer: str }, required: ["answer"] },
  });
  const ids = new Set(facts.map((f) => f.id));
  // validation: drop citations to facts that were not provided
  return (res.answer ?? "").replace(/\s?\[(F\d+)\]/g, (m, id) => (ids.has(id) ? m : "")).trim();
}

export async function ask(question: string, context: DraftContext, kg: KnowledgeGraph, docs: SourceDocument[]): Promise<AskResponse> {
  const questionTerms = await extractQuestionTerms(question, context, kg);
  const questionVectors = await translateToVectors(questionTerms, kg);
  const retrievedFacts = matchVectorsToFacts(questionTerms, questionVectors, kg); // P5 · [tool_1 match]
  const answer = await generateAnswer(question, retrievedFacts);
  const answerFacts = composeAnswerFacts(answer, retrievedFacts, kg); // P5 · [tool_3 compose]
  const answerSources = matchFactSources(answerFacts, kg, docs); // P5 · [tool_3 match]
  return { questionTerms, questionVectors, retrievedFacts, answer, answerFacts, answerSources };
}
