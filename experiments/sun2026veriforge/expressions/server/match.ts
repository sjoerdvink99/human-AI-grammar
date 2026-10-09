// tool_1 match: concept vectors × knowledge-graph entity vectors → facts (candidate_facts / query_facts).
import { cosine, embed, matchThreshold } from './embed.ts';
import { normalizeName, relationStatement } from '../shared/tools.ts';
import type { Concept, Fact, KnowledgeGraph } from '../shared/types.ts';

/** Retrieval index over the knowledge graph (entity vectors), rebuilt when the graph changes. */
let index: { builtAt: string; vectors: number[][] } | null = null;

export const entityText = (kg: KnowledgeGraph, i: number) => {
  const e = kg.nodes[i];
  return [e.name, e.aliases.join(', '), e.description].filter(Boolean).join('. ');
};

async function kgVectors(kg: KnowledgeGraph) {
  if (!index || index.builtAt !== kg.builtAt) {
    index = { builtAt: kg.builtAt, vectors: await embed(kg.nodes.map((_, i) => entityText(kg, i))) };
  }
  return index.vectors;
}

export async function matchFacts(concepts: Concept[], vectors: number[][], kg: KnowledgeGraph, perConcept = 2): Promise<Fact[]> {
  if (!kg.nodes.length) return [];
  const ev = await kgVectors(kg);
  const threshold = matchThreshold();
  const facts: Fact[] = [];
  const seen = new Set<string>();

  concepts.forEach((c, ci) => {
    const keys = [normalizeName(c.concept), normalizeName(c.mention)];
    const scored = kg.nodes
      .map((e, i) => {
        const exact = [e.name, ...e.aliases].some((n) => keys.includes(normalizeName(n)));
        return { e, score: exact ? 1 : cosine(vectors[ci], ev[i]) };
      })
      .filter((s) => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, perConcept);

    for (const { e, score } of scored) {
      const key = `${c.mention.toLowerCase()}|${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rels = kg.links.filter((r) => r.source === e.id || r.target === e.id).slice(0, 8);
      facts.push({
        id: `F${facts.length + 1}`,
        mention: c.mention,
        entityId: e.id,
        entityName: e.name,
        entityType: e.type,
        description: e.description,
        statements: rels.map((r) => relationStatement(kg, r) + (r.evidence ? ` ("${r.evidence}")` : '')),
        relationIds: rels.map((r) => r.id),
        score: Math.round(score * 100) / 100,
        sourceDocIds: e.sourceDocIds,
      });
    }
  });
  return facts;
}
