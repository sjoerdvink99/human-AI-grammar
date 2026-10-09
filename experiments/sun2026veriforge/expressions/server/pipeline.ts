// model_1 steps from design.json. One prompt per operation, built only from the preceding state.
import { callModel } from './model.ts';
import type { DocumentExtraction, RawEntity, RawRelation } from '../shared/tools.ts';
import type { Concept, Fact, HighlightSpan, KnowledgeGraph, SemanticFrame, SourceDocument } from '../shared/types.ts';

const str = { type: 'string' } as const;

// ---------------------------------------------------------------------------
// Process 1 — [model_1 extract]: source_documents* → domain_entities* + domain_relations*
// ---------------------------------------------------------------------------

const DOMAIN_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: str, type: str, description: str, aliases: { type: 'array', items: str } },
        required: ['name', 'type', 'description', 'aliases'],
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { subject: str, predicate: str, object: str, evidence: str },
        required: ['subject', 'predicate', 'object', 'evidence'],
      },
    },
  },
  required: ['entities', 'relations'],
};

function chunk(text: string, size = 8000): string[] {
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) { out.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
    while (cur.length > size) { out.push(cur.slice(0, size)); cur = cur.slice(size); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export async function extractDomain(doc: SourceDocument): Promise<DocumentExtraction> {
  const parts = chunk(doc.text);
  const results = await Promise.all(
    parts.map((part, i) =>
      callModel<{ entities: RawEntity[]; relations: RawRelation[] }>({
        role: 'model_1 extract (domain)',
        system:
          'You build knowledge graphs from documents. Extract the domain entities (people, organizations, places, ' +
          'concepts, methods, events, artifacts, quantities) and the factual relations between them stated in the text. ' +
          'Use concise canonical entity names; list other surface forms as aliases. Each relation is a ' +
          'subject–predicate–object triple whose subject and object are entity names you listed; the predicate is a short ' +
          'verb phrase; evidence is a short verbatim quote (max 25 words) supporting it. Do not invent facts not in the text.',
        prompt: `Document: "${doc.title}"${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ''}\n\n${part}`,
        schema: DOMAIN_SCHEMA,
      }),
    ),
  );
  return {
    docId: doc.id,
    entities: results.flatMap((r) => r.entities ?? []),
    relations: results.flatMap((r) => r.relations ?? []),
  };
}

// ---------------------------------------------------------------------------
// Process 3 / 5 — [model_1 extract]: (draft | query) + semantic_frame + knowledge_graph → concepts*
// ---------------------------------------------------------------------------

const CONCEPT_SCHEMA = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: { type: 'object', properties: { mention: str, concept: str }, required: ['mention', 'concept'] },
    },
  },
  required: ['concepts'],
};

function frameText(frame: SemanticFrame) {
  return [
    frame.focus && `Focus: ${frame.focus}`,
    frame.keyTerms.length && `Key terms: ${frame.keyTerms.join(', ')}`,
    frame.canvasEntities.length && `Entities the writer pinned on the canvas: ${frame.canvasEntities.join(', ')}`,
    frame.canvasRelations.length && `Connections on the canvas: ${frame.canvasRelations.join('; ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function kgVocabulary(kg: KnowledgeGraph, max = 300) {
  return kg.nodes
    .slice(0, max)
    .map((n) => n.name)
    .join(', ');
}

export async function extractConcepts(kind: 'draft' | 'query', text: string, frame: SemanticFrame, kg: KnowledgeGraph): Promise<Concept[]> {
  const out = await callModel<{ concepts: Concept[] }>({
    role: `model_1 extract (${kind} concepts)`,
    system:
      (kind === 'draft'
        ? "You identify the concepts in a writer's draft that could be checked against or enriched by a knowledge base. "
        : "You identify the concepts a writer's question is about, so they can be looked up in a knowledge base. ") +
      'For each concept return "mention": the exact substring as it appears in the text (copy it character for character, ' +
      'a short noun phrase of 1–6 words), and "concept": its canonical name, preferring a name from the knowledge-base ' +
      'vocabulary when one refers to the same thing. Prefer concepts relevant to the semantic frame. ' +
      `Return at most ${kind === 'draft' ? 25 : 8} concepts, no duplicates.`,
    prompt:
      `Semantic frame:\n${frameText(frame) || '(empty)'}\n\n` +
      `Knowledge-base vocabulary: ${kgVocabulary(kg) || '(empty)'}\n\n` +
      `${kind === 'draft' ? 'Draft' : 'Question'}:\n"""\n${text}\n"""`,
    schema: CONCEPT_SCHEMA,
  });
  let concepts = (out.concepts ?? []).filter((c) => c.mention?.trim() && c.concept?.trim());
  if (kind === 'draft') {
    // Validation: a draft concept must refer to text that is actually in the draft.
    const lower = text.toLowerCase();
    concepts = concepts.filter((c) => lower.includes(c.mention.trim().toLowerCase()));
  }
  const seen = new Set<string>();
  return concepts
    .map((c) => ({ mention: c.mention.trim(), concept: c.concept.trim() }))
    .filter((c) => !seen.has(c.mention.toLowerCase()) && seen.add(c.mention.toLowerCase()))
    .slice(0, kind === 'draft' ? 25 : 8);
}

function factsText(facts: Fact[]) {
  return facts
    .map(
      (f) =>
        `[${f.id}] ${f.entityName} (${f.entityType})${f.description ? `: ${f.description}` : ''}` +
        (f.statements.length ? `\n  ${f.statements.join('\n  ')}` : ''),
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Process 4 — [model_1 generate]~: clicked_span + candidate_facts* → card_explanation
// ---------------------------------------------------------------------------

export async function generateExplanation(span: HighlightSpan, facts: Fact[]): Promise<string> {
  const own = facts.filter((f) => span.factIds.includes(f.id));
  const out = await callModel<{ explanation: string }>({
    role: 'model_1 generate (card explanation)',
    system:
      'You help a writer ground their text in a knowledge base. Given a phrase from their draft and the knowledge-base ' +
      'facts matched to it, write 2–4 sentences explaining what the knowledge base says about it and how it relates to the ' +
      'phrase: whether it supports, contradicts or adds to it. Use only the given facts. Plain prose, no lists, and do not ' +
      'mention fact ids or the words "fact F".',
    prompt: `Phrase from the draft: "${span.text}"\n\nMatched facts:\n${factsText(own.length ? own : facts)}`,
    schema: { type: 'object', properties: { explanation: str }, required: ['explanation'] },
  });
  const text = out.explanation?.trim();
  if (!text) throw new Error('model_1 generate: empty explanation');
  return text;
}

// ---------------------------------------------------------------------------
// Process 5 — [model_1 generate]~: query + query_facts* → query_answer
// ---------------------------------------------------------------------------

export async function generateAnswer(query: string, facts: Fact[]): Promise<string> {
  const out = await callModel<{ answer: string }>({
    role: 'model_1 generate (query answer)',
    system:
      "You answer a writer's question using only the retrieved knowledge-base facts. Cite the facts you use with their " +
      'ids in square brackets right after the claim, e.g. "... was founded in 1998 [F2]." Mention entities by their names. ' +
      'If the facts do not answer the question, say so briefly and state what they do cover. Keep it under 150 words.',
    prompt: `Question: ${query}\n\nRetrieved facts:\n${factsText(facts) || '(none)'}`,
    schema: { type: 'object', properties: { answer: str }, required: ['answer'] },
  });
  const text = out.answer?.trim();
  if (!text) throw new Error('model_1 generate: empty answer');
  return text;
}
