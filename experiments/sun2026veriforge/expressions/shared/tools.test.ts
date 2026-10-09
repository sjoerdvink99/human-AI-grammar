import { describe, expect, it } from 'vitest';
import {
  addCardsToCanvas,
  composeCanvasEdges,
  composeHighlightCard,
  composeKnowledgeGraph,
  composeQueryCards,
  composeSemanticFrame,
  linkAnswerToCards,
  locateOriginSpan,
  matchRelatedEdges,
  selectHighlightSpans,
  shiftSpans,
  validateCitations,
} from './tools.ts';
import type { Fact } from './types.ts';

const kg = composeKnowledgeGraph(
  [{ id: 'd1', title: 'Doc' }],
  [
    {
      docId: 'd1',
      entities: [
        { name: 'Coral bleaching', type: 'process', description: 'Loss of algae', aliases: ['bleaching'] },
        { name: 'Zooxanthellae', type: 'organism', description: 'Algae', aliases: [] },
        { name: 'Climate change', type: 'phenomenon', description: '', aliases: [] },
        { name: 'coral bleaching', type: 'process', description: 'Corals expel algae under heat stress', aliases: [] },
      ],
      relations: [
        { subject: 'Coral bleaching', predicate: 'expels', object: 'Zooxanthellae', evidence: 'expel their zooxanthellae' },
        { subject: 'Climate change', predicate: 'causes', object: 'bleaching', evidence: '' },
        { subject: 'Climate change', predicate: 'causes', object: 'Coral bleaching', evidence: 'dup' },
      ],
    },
  ],
);

const fact = (id: string, mention: string, entityName: string): Fact => {
  const e = kg.nodes.find((n) => n.name === entityName)!;
  return { id, mention, entityId: e.id, entityName, entityType: e.type, description: '', statements: [], relationIds: [], score: 0.9, sourceDocIds: ['d1'] };
};

describe('process 1: composeKnowledgeGraph', () => {
  it('merges entities by name/alias and dedupes relations', () => {
    expect(kg.nodes).toHaveLength(3);
    expect(kg.nodes[0].description).toBe('Corals expel algae under heat stress');
    expect(kg.links).toHaveLength(2);
  });
});

describe('process 2/9: composeSemanticFrame', () => {
  it('derives focus, key terms and canvas entities', () => {
    const f = composeSemanticFrame('Reefs are dying. Reefs need help from reefs science.', {
      nodes: [{ id: 'n', kind: 'gold', cardId: 'c', title: 'Coral bleaching', entityIds: [], position: { x: 0, y: 0 } }],
      edges: [],
    });
    expect(f.focus).toBe('Reefs are dying.');
    expect(f.keyTerms[0]).toBe('reefs');
    expect(f.canvasEntities).toEqual(['Coral bleaching']);
  });
});

describe('process 3: selectHighlightSpans + shiftSpans', () => {
  const draft = 'Bleaching is driven by climate change; bleaching kills reefs.';
  const facts = [fact('F1', 'bleaching', 'Coral bleaching'), fact('F2', 'climate change', 'Climate change')];
  const spans = selectHighlightSpans(draft, facts);
  it('finds whole-word, non-overlapping occurrences', () => {
    expect(spans.map((s) => s.text)).toEqual(['Bleaching', 'climate change', 'bleaching']);
  });
  it('keeps spans aligned through edits', () => {
    const next = 'Today, ' + draft;
    const shifted = shiftSpans(draft, next, spans);
    expect(shifted.every((s) => next.slice(s.start, s.end) === s.text)).toBe(true);
  });
});

describe('process 4/5/6/7: cards, links and canvas', () => {
  const span = selectHighlightSpans('Bleaching kills.', [fact('F1', 'Bleaching', 'Coral bleaching')])[0];
  const hcard = composeHighlightCard('Explanation.', span, [fact('F1', 'Bleaching', 'Coral bleaching')]);
  const qcards = composeQueryCards('t1', [fact('F1', 'algae', 'Zooxanthellae'), fact('F2', 'warming', 'Climate change')]);

  it('links answer text and citations to query cards', () => {
    const answer = validateCitations('Zooxanthellae are algae [F1] and warming matters [F2][F9].', qcards[0].facts.concat(qcards[1].facts));
    expect(answer).not.toContain('[F9]');
    const links = linkAnswerToCards(answer, qcards);
    expect(links.some((l) => answer.slice(l.start, l.end) === '[F1]' && l.cardId === qcards[0].id)).toBe(true);
    expect(links.some((l) => answer.slice(l.start, l.end) === 'Zooxanthellae')).toBe(true);
  });

  it('adds cards to the canvas and connects them through the knowledge graph', () => {
    const c2 = addCardsToCanvas({ nodes: [], edges: [] }, [hcard, ...qcards]);
    expect(c2.nodes.map((n) => n.kind)).toEqual(['gold', 'silver', 'silver']);
    const c3 = composeCanvasEdges(c2, matchRelatedEdges(c2, kg));
    expect(c3.edges.length).toBe(3); // bleaching–zoox (1 hop), bleaching–climate (1 hop), zoox–climate (2 hops)
    expect(c3.edges.find((e) => e.hops === 2)?.label).toBe('via Coral bleaching');
  });

  it('locates the origin span after the draft moved', () => {
    expect(locateOriginSpan('New intro. Bleaching kills.', hcard.span)).toEqual({ start: 11, end: 20 });
    expect(locateOriginSpan('Nothing here.', hcard.span)).toBeNull();
  });
});
