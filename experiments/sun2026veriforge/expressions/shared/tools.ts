// Deterministic tool steps (tool_1, tool_2, tool_3) from design.json. Pure functions, unit-tested.
import type {
  CanvasEdge,
  CanvasGraph,
  CanvasNode,
  Card,
  ChatTurn,
  DomainEntity,
  DomainRelation,
  Fact,
  HighlightCard,
  HighlightSpan,
  KnowledgeGraph,
  QueryCard,
  SemanticFrame,
  SourceDocument,
  TextCardLink,
} from './types.ts';

let counter = 0;
export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// Process 1 — [tool_1 compose]: domain_entities* + domain_relations* → knowledge_graph
// ---------------------------------------------------------------------------

export interface RawEntity {
  name: string;
  type: string;
  description: string;
  aliases: string[];
}
export interface RawRelation {
  subject: string;
  predicate: string;
  object: string;
  evidence: string;
}
export interface DocumentExtraction {
  docId: string;
  entities: RawEntity[];
  relations: RawRelation[];
}

export function composeKnowledgeGraph(
  documents: Pick<SourceDocument, 'id' | 'title'>[],
  extractions: DocumentExtraction[],
): KnowledgeGraph {
  const byKey = new Map<string, DomainEntity>();
  const nodes: DomainEntity[] = [];

  const resolve = (name: string) => byKey.get(normalizeName(name));
  const register = (e: DomainEntity, names: string[]) => {
    for (const n of names) {
      const k = normalizeName(n);
      if (k && !byKey.has(k)) byKey.set(k, e);
    }
  };
  const upsert = (raw: RawEntity, docId: string): DomainEntity | undefined => {
    const name = raw.name?.trim();
    if (!name || !normalizeName(name)) return undefined;
    const aliases = (raw.aliases ?? []).map((a) => a.trim()).filter(Boolean);
    const existing = resolve(name) ?? aliases.map(resolve).find(Boolean);
    if (existing) {
      if (!existing.sourceDocIds.includes(docId)) existing.sourceDocIds.push(docId);
      if (raw.description && raw.description.length > existing.description.length) existing.description = raw.description;
      for (const a of [name, ...aliases]) {
        if (normalizeName(a) !== normalizeName(existing.name) && !existing.aliases.some((x) => normalizeName(x) === normalizeName(a)))
          existing.aliases.push(a);
      }
      register(existing, [name, ...aliases]);
      return existing;
    }
    const e: DomainEntity = {
      id: `e${nodes.length + 1}`,
      name,
      type: raw.type?.trim() || 'concept',
      description: raw.description?.trim() ?? '',
      aliases: aliases.filter((a) => normalizeName(a) !== normalizeName(name)),
      sourceDocIds: [docId],
    };
    nodes.push(e);
    register(e, [name, ...aliases]);
    return e;
  };

  for (const ex of extractions) for (const raw of ex.entities) upsert(raw, ex.docId);

  const links: DomainRelation[] = [];
  const seen = new Set<string>();
  for (const ex of extractions) {
    for (const r of ex.relations) {
      if (!r.subject || !r.object || !r.predicate) continue;
      const s = resolve(r.subject) ?? upsert({ name: r.subject, type: 'concept', description: '', aliases: [] }, ex.docId);
      const t = resolve(r.object) ?? upsert({ name: r.object, type: 'concept', description: '', aliases: [] }, ex.docId);
      if (!s || !t || s.id === t.id) continue;
      const predicate = r.predicate.trim();
      const key = `${s.id}|${normalizeName(predicate)}|${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ id: `r${links.length + 1}`, source: s.id, target: t.id, predicate, evidence: r.evidence?.trim() ?? '', sourceDocId: ex.docId });
    }
  }

  return { nodes, links, documents: documents.map((d) => ({ id: d.id, title: d.title })), builtAt: new Date().toISOString() };
}

export function relationStatement(kg: KnowledgeGraph, r: DomainRelation): string {
  const name = (id: string) => kg.nodes.find((n) => n.id === id)?.name ?? id;
  return `${name(r.source)} — ${r.predicate} → ${name(r.target)}`;
}

// ---------------------------------------------------------------------------
// Processes 2 & 9 — [tool_2 compose]: draft + canvas → semantic_frame
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves one two many much may might must shall us within without however thus therefore also often more less like make made use used using new well even still'
  ).split(' '),
);

export function composeSemanticFrame(draft: string, canvas: CanvasGraph): SemanticFrame {
  const text = draft.trim();
  const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? '';
  const focus = firstSentence.replace(/^#+\s*/, '').slice(0, 160);

  const words = text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]{2,}/gu) ?? [];
  const tf = new Map<string, number>();
  for (const w of words) if (!STOPWORDS.has(w)) tf.set(w, (tf.get(w) ?? 0) + 1);
  const keyTerms = [...tf.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([w]) => w);

  const title = (id: string) => canvas.nodes.find((n) => n.id === id)?.title ?? id;
  return {
    focus,
    keyTerms,
    canvasEntities: [...new Set(canvas.nodes.map((n) => n.title))],
    canvasRelations: canvas.edges.map((e) => `${title(e.source)} — ${e.label} — ${title(e.target)}`),
    wordCount: words.length,
  };
}

// ---------------------------------------------------------------------------
// Process 3 — [tool_3 select]: candidate_facts* + draft → highlight_spans*
// ---------------------------------------------------------------------------

function findAll(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let i = h.indexOf(n);
  while (i !== -1) {
    const before = i === 0 ? ' ' : haystack[i - 1];
    const after = haystack[i + n.length] ?? ' ';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) out.push(i);
    i = h.indexOf(n, i + 1);
  }
  return out;
}

export function selectHighlightSpans(draft: string, facts: Fact[]): HighlightSpan[] {
  const byMention = new Map<string, Fact[]>();
  for (const f of facts) {
    const k = f.mention.trim();
    if (!k) continue;
    byMention.set(k, [...(byMention.get(k) ?? []), f]);
  }
  const mentions = [...byMention.keys()].sort((a, b) => b.length - a.length);
  const spans: HighlightSpan[] = [];
  const overlaps = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);
  for (const m of mentions) {
    for (const start of findAll(draft, m)) {
      const end = start + m.length;
      if (overlaps(start, end)) continue;
      spans.push({ id: uid('span'), start, end, text: draft.slice(start, end), factIds: byMention.get(m)!.map((f) => f.id) });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Keeps highlight spans aligned while the draft is edited (draft_1 → draft_2); spans touching the edit are dropped. */
export function shiftSpans(oldDraft: string, newDraft: string, spans: HighlightSpan[]): HighlightSpan[] {
  let pre = 0;
  while (pre < oldDraft.length && pre < newDraft.length && oldDraft[pre] === newDraft[pre]) pre++;
  let suf = 0;
  while (
    suf < oldDraft.length - pre &&
    suf < newDraft.length - pre &&
    oldDraft[oldDraft.length - 1 - suf] === newDraft[newDraft.length - 1 - suf]
  )
    suf++;
  const oldEnd = oldDraft.length - suf;
  const delta = newDraft.length - oldDraft.length;
  return spans.flatMap((s) => {
    if (s.end <= pre) return [s];
    if (s.start >= oldEnd) return [{ ...s, start: s.start + delta, end: s.end + delta }];
    return [];
  });
}

// ---------------------------------------------------------------------------
// Process 4 — [tool_3 compose]: card_explanation + clicked_span + candidate_facts* → highlight_card
// ---------------------------------------------------------------------------

export function composeHighlightCard(explanation: string, span: HighlightSpan, facts: Fact[]): HighlightCard {
  const own = facts.filter((f) => span.factIds.includes(f.id));
  return {
    id: uid('hcard'),
    kind: 'highlight',
    span: { ...span },
    title: own[0]?.entityName ?? span.text,
    explanation,
    facts: own,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Process 5 — [tool_3 compose]: query_answer + query_facts* → query_cards*
//           — [tool_3 match]:   query_answer + query_cards* → text_card_links*
// ---------------------------------------------------------------------------

export function composeQueryCards(turnId: string, facts: Fact[]): QueryCard[] {
  const byEntity = new Map<string, Fact[]>();
  for (const f of facts) byEntity.set(f.entityId, [...(byEntity.get(f.entityId) ?? []), f]);
  return [...byEntity.values()].map((fs) => ({
    id: uid('qcard'),
    kind: 'query' as const,
    turnId,
    title: fs[0].entityName,
    facts: fs,
    createdAt: new Date().toISOString(),
  }));
}

export const CITATION_RE = /\[(F\d+)\]/g;

export function linkAnswerToCards(answer: string, cards: QueryCard[]): TextCardLink[] {
  const links: TextCardLink[] = [];
  const overlaps = (s: number, e: number) => links.some((x) => s < x.end && e > x.start);
  // citation markers [F#] → card holding that fact
  for (const m of answer.matchAll(CITATION_RE)) {
    const card = cards.find((c) => c.facts.some((f) => f.id === m[1]));
    if (card) links.push({ cardId: card.id, start: m.index!, end: m.index! + m[0].length });
  }
  // mentions of the card's entity (name or matched mention) in the answer prose
  for (const card of cards) {
    const names = [...new Set([card.title, ...card.facts.map((f) => f.mention)])].sort((a, b) => b.length - a.length);
    for (const n of names) {
      for (const start of findAll(answer, n)) {
        const end = start + n.length;
        if (!overlaps(start, end)) links.push({ cardId: card.id, start, end });
      }
    }
  }
  return links.sort((a, b) => a.start - b.start);
}

/** Removes citation markers that do not refer to a retrieved fact (validation of generated answer). */
export function validateCitations(answer: string, facts: Fact[]): string {
  const ids = new Set(facts.map((f) => f.id));
  return answer.replace(CITATION_RE, (all, id) => (ids.has(id) ? all : '')).replace(/[ \t]+([.,;:])/g, '$1');
}

// ---------------------------------------------------------------------------
// Process 6 — [tool_3 compose] → canvas_2, [tool_1 match] → related_edges, [tool_3 compose] → canvas_3
// ---------------------------------------------------------------------------

export function addCardsToCanvas(
  canvas: CanvasGraph,
  cards: Card[],
  position?: { x: number; y: number },
): CanvasGraph {
  const nodes = [...canvas.nodes];
  cards.forEach((card, i) => {
    if (nodes.some((n) => n.cardId === card.id)) return;
    const k = nodes.length;
    nodes.push({
      id: uid('node'),
      kind: card.kind === 'highlight' ? 'gold' : 'silver',
      cardId: card.id,
      title: card.title,
      entityIds: [...new Set(card.facts.map((f) => f.entityId))],
      position: position
        ? { x: position.x + i * 30, y: position.y + i * 30 }
        : { x: 40 + (k % 3) * 280, y: 40 + Math.floor(k / 3) * 150 },
    });
  });
  return { nodes, edges: canvas.edges };
}

export function matchRelatedEdges(canvas: CanvasGraph, kg: KnowledgeGraph): CanvasEdge[] {
  const edges: CanvasEdge[] = [];
  const name = (id: string) => kg.nodes.find((n) => n.id === id)?.name ?? id;
  const adj = new Map<string, DomainRelation[]>();
  for (const r of kg.links) {
    adj.set(r.source, [...(adj.get(r.source) ?? []), r]);
    adj.set(r.target, [...(adj.get(r.target) ?? []), r]);
  }
  const other = (r: DomainRelation, id: string) => (r.source === id ? r.target : r.source);

  for (let i = 0; i < canvas.nodes.length; i++) {
    for (let j = i + 1; j < canvas.nodes.length; j++) {
      const a = canvas.nodes[i];
      const b = canvas.nodes[j];
      const A = new Set(a.entityIds);
      const B = new Set(b.entityIds);
      const shared = [...A].filter((x) => B.has(x));
      if (shared.length) {
        edges.push({ id: `${a.id}~${b.id}`, source: a.id, target: b.id, label: `same: ${name(shared[0])}`, relationIds: [], hops: 1 });
        continue;
      }
      const direct = kg.links.filter((r) => (A.has(r.source) && B.has(r.target)) || (B.has(r.source) && A.has(r.target)));
      if (direct.length) {
        edges.push({
          id: `${a.id}~${b.id}`,
          source: a.id,
          target: b.id,
          label: direct.slice(0, 2).map((r) => r.predicate).join(' / '),
          relationIds: direct.map((r) => r.id),
          hops: 1,
        });
        continue;
      }
      // two-hop path a — x — b
      let found: CanvasEdge | undefined;
      for (const ea of A) {
        for (const r1 of adj.get(ea) ?? []) {
          const mid = other(r1, ea);
          const r2 = (adj.get(mid) ?? []).find((r) => B.has(other(r, mid)));
          if (r2) {
            found = { id: `${a.id}~${b.id}`, source: a.id, target: b.id, label: `via ${name(mid)}`, relationIds: [r1.id, r2.id], hops: 2 };
            break;
          }
        }
        if (found) break;
      }
      if (found) edges.push(found);
    }
  }
  return edges;
}

export function composeCanvasEdges(canvas: CanvasGraph, related: CanvasEdge[]): CanvasGraph {
  return { nodes: canvas.nodes, edges: related };
}

export function removeCanvasNode(canvas: CanvasGraph, nodeId: string): CanvasGraph {
  return {
    nodes: canvas.nodes.filter((n) => n.id !== nodeId),
    edges: canvas.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

// ---------------------------------------------------------------------------
// Process 7 — [tool_3 match]: gold_node → origin_span in draft
// Process 8 — [tool_3 match]: silver_node → query_turn in chat
// ---------------------------------------------------------------------------

export function locateOriginSpan(draft: string, span: Pick<HighlightSpan, 'start' | 'text'>): { start: number; end: number } | null {
  if (draft.slice(span.start, span.start + span.text.length) === span.text) return { start: span.start, end: span.start + span.text.length };
  let hits = findAll(draft, span.text);
  if (!hits.length) {
    const i = draft.toLowerCase().indexOf(span.text.toLowerCase());
    hits = i >= 0 ? [i] : [];
  }
  if (!hits.length) return null;
  const best = hits.reduce((a, b) => (Math.abs(b - span.start) < Math.abs(a - span.start) ? b : a));
  return { start: best, end: best + span.text.length };
}

export function findQueryTurn(node: CanvasNode, cards: Card[], turns: ChatTurn[]): ChatTurn | null {
  const card = cards.find((c) => c.id === node.cardId);
  if (!card || card.kind !== 'query') return null;
  return turns.find((t) => t.id === card.turnId) ?? null;
}
