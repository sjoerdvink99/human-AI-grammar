// Deterministic tool steps (tool_1, tool_2, tool_3). Shared by server and client.
import type {
  AnswerFact,
  DraftClaim,
  DraftContext,
  Entity,
  FactSource,
  Grounding,
  ItemVector,
  KGEdge,
  KGFact,
  KGNode,
  KnowledgeGraph,
  MapEdge,
  MapNode,
  QueryTerm,
  Relation,
  SourceDocument,
  SuggestionCard,
  TextSpan,
  WritingMap,
} from "./types";

export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/s\b/g, ""); // crude singularisation so "reefs" and "reef" merge

const nodeIdFor = (name: string) => "n:" + normalizeName(name).replace(/ /g, "-");

let counter = 0;
export const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---------------------------------------------------------------- P1
/** P1 · [tool_1 compose]: r2* + r3* → r4 */
export function composeKnowledgeGraph(entities: Entity[], relations: Relation[]): KnowledgeGraph {
  const nodes = new Map<string, KGNode>();
  const ensure = (name: string, type = "concept", description = "", docId?: string) => {
    const id = nodeIdFor(name);
    if (!normalizeName(name)) return null;
    let n = nodes.get(id);
    if (!n) {
      n = { id, name: name.trim(), type, description, docIds: [] };
      nodes.set(id, n);
    } else {
      if (!n.description && description) n.description = description;
      if (n.type === "concept" && type !== "concept") n.type = type;
    }
    if (docId && !n.docIds.includes(docId)) n.docIds.push(docId);
    return n;
  };
  for (const e of entities) ensure(e.name, e.type || "concept", e.description, e.docId);
  const edges = new Map<string, KGEdge>();
  for (const r of relations) {
    const s = ensure(r.source, "concept", "", r.docId);
    const t = ensure(r.target, "concept", "", r.docId);
    if (!s || !t || s.id === t.id) continue;
    const label = r.label.trim().toLowerCase();
    const id = `e:${s.id}|${label}|${t.id}`;
    let edge = edges.get(id);
    if (!edge) {
      edge = { id, source: s.id, target: t.id, label, evidence: [], docIds: [] };
      edges.set(id, edge);
    }
    if (r.evidence && !edge.evidence.includes(r.evidence)) edge.evidence.push(r.evidence);
    if (!edge.docIds.includes(r.docId)) edge.docIds.push(r.docId);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

// ---------------------------------------------------------------- P2 / P9
/** P2, P9 · [tool_2 compose]: r5 + r6 → r7 */
export function composeDraftContext(draft: string, map: WritingMap, draftVersion: number): DraftContext {
  const paragraphs: DraftContext["paragraphs"] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft))) {
    if (m[0].trim()) paragraphs.push({ index: paragraphs.length, start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const mapConcepts = [...new Set(map.nodes.map((n) => n.label))];
  return { wordCount, paragraphs, mapConcepts, draftVersion };
}

// ---------------------------------------------------------------- P3
/** P3 · [tool_1 match]: r9* + r4 → r10* */
export function matchVectorsToGraph(
  claims: DraftClaim[],
  vectors: ItemVector[],
  kg: KnowledgeGraph,
  threshold = 0.5,
  topK = 4,
): Grounding[] {
  const out: Grounding[] = [];
  for (const claim of claims) {
    const v = vectors.find((x) => x.itemId === claim.id);
    if (!v) continue;
    const matches = topMatches(v.scores, kg, threshold, topK);
    if (!matches.length) continue;
    const ids = new Set(matches.map((m) => m.nodeId));
    let edgeIds = kg.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => e.id);
    if (edgeIds.length < 3) {
      const extra = kg.edges
        .filter((e) => (e.source === matches[0].nodeId || e.target === matches[0].nodeId) && !edgeIds.includes(e.id))
        .slice(0, 3 - edgeIds.length)
        .map((e) => e.id);
      edgeIds = edgeIds.concat(extra);
    }
    out.push({ claimId: claim.id, quote: claim.quote, matches, edgeIds });
  }
  return out;
}

function topMatches(scores: number[], kg: KnowledgeGraph, threshold: number, topK: number) {
  return scores
    .map((score, i) => ({ score, node: kg.nodes[i] }))
    .filter((x) => x.node && x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => ({ nodeId: x.node.id, name: x.node.name, score: x.score }));
}

/** Locate a quote in a text: exact, then case-insensitive, then whitespace-insensitive. */
export function findSpan(text: string, quote: string, from = 0): TextSpan | null {
  const q = quote.trim();
  if (!q) return null;
  let i = text.indexOf(q, from);
  if (i < 0) i = text.toLowerCase().indexOf(q.toLowerCase(), from);
  if (i >= 0) return { start: i, end: i + q.length, text: text.slice(i, i + q.length) };
  const pattern = q
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const re = new RegExp(pattern, "i");
  const m = re.exec(text.slice(from));
  if (!m) return null;
  return { start: from + m.index, end: from + m.index + m[0].length, text: m[0] };
}

function dropOverlaps(spans: TextSpan[]): TextSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextSpan[] = [];
  for (const s of sorted) if (!out.length || s.start >= out[out.length - 1].end) out.push(s);
  return out;
}

/** P3 · [tool_3 select]: r10* + r5 → r11* */
export function selectGroundedSpans(draft: string, groundings: Grounding[]): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const g of groundings) {
    const s = findSpan(draft, g.quote);
    if (s) spans.push({ ...s, refId: g.claimId });
  }
  return dropOverlaps(spans);
}

// ---------------------------------------------------------------- P4
/** P4 · [tool_3 compose]: r13 + r12 + r10* → r14 */
export function composeSuggestionCard(span: TextSpan, suggestion: string, groundings: Grounding[]): SuggestionCard {
  const g = groundings.find((x) => x.claimId === span.refId);
  return {
    id: uid("sc"),
    spanText: span.text,
    suggestion: suggestion.trim(),
    nodeIds: g ? g.matches.map((m) => m.nodeId) : [],
    edgeIds: g ? g.edgeIds : [],
  };
}

// ---------------------------------------------------------------- P5
export const nodeFactText = (n: KGNode) => `${n.name} (${n.type})${n.description ? ": " + n.description : ""}`;
export function edgeFactText(e: KGEdge, kg: KnowledgeGraph) {
  const s = kg.nodes.find((n) => n.id === e.source)?.name ?? e.source;
  const t = kg.nodes.find((n) => n.id === e.target)?.name ?? e.target;
  return `${s} —${e.label}→ ${t}${e.evidence[0] ? `. Evidence: "${e.evidence[0]}"` : ""}`;
}

/** P5 · [tool_1 match]: r17* + r4 → r18* */
export function matchVectorsToFacts(
  terms: QueryTerm[],
  vectors: ItemVector[],
  kg: KnowledgeGraph,
  threshold = 0.5,
  maxNodes = 8,
  maxEdges = 12,
): KGFact[] {
  const best = new Array(kg.nodes.length).fill(0);
  for (const t of terms) {
    const v = vectors.find((x) => x.itemId === t.id);
    v?.scores.forEach((s, i) => (best[i] = Math.max(best[i], s)));
  }
  const nodeScore = new Map<string, number>();
  best
    .map((score, i) => ({ score, node: kg.nodes[i] }))
    .filter((x) => x.node && x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxNodes)
    .forEach((x) => nodeScore.set(x.node.id, x.score));
  const edgeFacts = kg.edges
    .map((e) => {
      const a = nodeScore.get(e.source) ?? 0;
      const b = nodeScore.get(e.target) ?? 0;
      const score = a && b ? (a + b) / 2 : Math.max(a, b) * 0.8;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxEdges);
  const facts: KGFact[] = [];
  for (const [id, score] of nodeScore) {
    const n = kg.nodes.find((x) => x.id === id)!;
    facts.push({ id: "", kind: "node", refId: id, text: nodeFactText(n), score });
  }
  for (const { e, score } of edgeFacts) facts.push({ id: "", kind: "edge", refId: e.id, text: edgeFactText(e, kg), score });
  return facts.map((f, i) => ({ ...f, id: `F${i + 1}` }));
}

/** P5 · [tool_3 compose]: r19 + r18* → r20* (cards for facts the answer cites) */
export function composeAnswerFacts(answer: string, facts: KGFact[], kg: KnowledgeGraph): AnswerFact[] {
  const cited = new Set([...answer.matchAll(/\[(F\d+)\]/g)].map((m) => m[1]));
  return facts
    .filter((f) => cited.has(f.id))
    .map((f) => {
      if (f.kind === "node") {
        const n = kg.nodes.find((x) => x.id === f.refId)!;
        return { id: uid("af"), factId: f.id, kind: f.kind, refId: f.refId, label: n.name, text: f.text, nodeIds: [n.id] };
      }
      const e = kg.edges.find((x) => x.id === f.refId)!;
      const s = kg.nodes.find((x) => x.id === e.source)?.name ?? "";
      const t = kg.nodes.find((x) => x.id === e.target)?.name ?? "";
      return { id: uid("af"), factId: f.id, kind: f.kind, refId: f.refId, label: `${s} ${e.label} ${t}`, text: f.text, nodeIds: [e.source, e.target] };
    });
}

function sentenceContaining(text: string, needle: string): string | null {
  const s = findSpan(text, needle);
  if (!s) return null;
  const before = text.lastIndexOf(".", s.start);
  const afterIdx = text.indexOf(".", s.end);
  return text.slice(before + 1, afterIdx < 0 ? undefined : afterIdx + 1).trim();
}

/** P5 · [tool_3 match]: r20* → r21* (source documents and snippets for each fact) */
export function matchFactSources(facts: AnswerFact[], kg: KnowledgeGraph, docs: SourceDocument[]): FactSource[] {
  const out: FactSource[] = [];
  for (const f of facts) {
    const ref = f.kind === "node" ? kg.nodes.find((n) => n.id === f.refId) : kg.edges.find((e) => e.id === f.refId);
    if (!ref) continue;
    for (const docId of ref.docIds) {
      const doc = docs.find((d) => d.id === docId);
      if (!doc) continue;
      let snippet: string | null = null;
      if (f.kind === "edge") {
        for (const ev of (ref as KGEdge).evidence) if (!snippet && findSpan(doc.text, ev)) snippet = ev;
      }
      if (!snippet) snippet = sentenceContaining(doc.text, f.kind === "node" ? (ref as KGNode).name : f.label.split(" ")[0]);
      out.push({ factId: f.factId, docId, docTitle: doc.title, snippet: snippet ?? doc.text.slice(0, 160) + "…" });
    }
  }
  return out;
}

// ---------------------------------------------------------------- P6
const shortLabel = (s: string, words = 6) => {
  const w = s.trim().split(/\s+/);
  return w.slice(0, words).join(" ") + (w.length > words ? "…" : "");
};

/** P6 · [tool_3 compose]: r6_1 + r22 + r23 → r6_2 */
export function addPinsToMap(
  map: WritingMap,
  card: SuggestionCard | null,
  fact: AnswerFact | null,
  kg: KnowledgeGraph,
): WritingMap {
  const nodes = [...map.nodes];
  const edges = [...map.edges];
  const names = (ids: string[]) => ids.map((id) => kg.nodes.find((n) => n.id === id)?.name).filter(Boolean) as string[];
  const added: MapNode[] = [];
  if (card && !nodes.some((n) => n.id === card.id)) {
    const n: MapNode = {
      id: card.id,
      label: shortLabel(card.spanText),
      kind: "suggestion",
      text: card.suggestion,
      kgNodeIds: card.nodeIds,
      anchors: [card.spanText, ...names(card.nodeIds)],
    };
    nodes.push(n);
    added.push(n);
  }
  if (fact && !nodes.some((n) => n.kind === "fact" && n.text === fact.text)) {
    const n: MapNode = {
      id: fact.id,
      label: shortLabel(fact.label, 8),
      kind: "fact",
      text: fact.text,
      kgNodeIds: fact.nodeIds,
      anchors: names(fact.nodeIds),
    };
    nodes.push(n);
    added.push(n);
  }
  if (added.length === 2)
    edges.push({ id: uid("me"), source: added[0].id, target: added[1].id, label: "pinned together", origin: "pin" });
  return { version: map.version + 1, nodes, edges };
}

/** P6 · [tool_1 match]: r6_2 + r4 → r24 (KG sub-graph connecting map nodes, up to 2 hops) */
export function matchMapToGraph(map: WritingMap, kg: KnowledgeGraph): KnowledgeGraph {
  const mapped = new Set(map.nodes.flatMap((n) => n.kgNodeIds));
  const edges = new Map<string, KGEdge>();
  const nodes = new Set<string>(mapped);
  const adj = new Map<string, KGEdge[]>();
  for (const e of kg.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e);
  }
  const other = (e: KGEdge, id: string) => (e.source === id ? e.target : e.source);
  for (const a of mapped) {
    for (const e1 of adj.get(a) ?? []) {
      const b = other(e1, a);
      if (mapped.has(b)) edges.set(e1.id, e1);
      else
        for (const e2 of adj.get(b) ?? []) {
          const c = other(e2, b);
          if (c !== a && mapped.has(c)) {
            edges.set(e1.id, e1);
            edges.set(e2.id, e2);
            nodes.add(b);
          }
        }
    }
  }
  return { nodes: kg.nodes.filter((n) => nodes.has(n.id)), edges: [...edges.values()] };
}

/** P6 · [tool_3 compose]: r6_2 + r24 → r6_3 (add KG-derived links between map nodes) */
export function linkMap(map: WritingMap, links: KnowledgeGraph): WritingMap {
  const edges: MapEdge[] = map.edges.filter((e) => e.origin === "pin");
  const name = (id: string) => links.nodes.find((n) => n.id === id)?.name ?? id;
  const owners = (kgId: string) => map.nodes.filter((n) => n.kgNodeIds.includes(kgId));
  const seen = new Set(edges.map((e) => [e.source, e.target].sort().join("|")));
  const add = (a: MapNode, b: MapNode, label: string) => {
    const key = [a.id, b.id].sort().join("|");
    if (a.id === b.id || seen.has(key)) return;
    seen.add(key);
    edges.push({ id: uid("me"), source: a.id, target: b.id, label, origin: "kg" });
  };
  // shared KG nodes
  for (let i = 0; i < map.nodes.length; i++)
    for (let j = i + 1; j < map.nodes.length; j++) {
      const shared = map.nodes[i].kgNodeIds.filter((id) => map.nodes[j].kgNodeIds.includes(id));
      if (shared.length) add(map.nodes[i], map.nodes[j], `both about ${name(shared[0])}`);
    }
  // direct edges and two-hop paths
  for (const e of links.edges) {
    for (const a of owners(e.source)) for (const b of owners(e.target)) add(a, b, e.label);
  }
  const byNode = new Map<string, KGEdge[]>();
  for (const e of links.edges) for (const id of [e.source, e.target]) byNode.set(id, [...(byNode.get(id) ?? []), e]);
  for (const [mid, es] of byNode) {
    if (owners(mid).length) continue;
    const ends = es.map((e) => (e.source === mid ? e.target : e.source));
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++)
        for (const a of owners(ends[i])) for (const b of owners(ends[j])) add(a, b, `via ${name(mid)}`);
  }
  return { version: map.version + 1, nodes: map.nodes, edges };
}

// ---------------------------------------------------------------- P7 / P8
/** P7, P8 · [tool_3 match]: selected map node + text → spans in that text */
export function matchNodeSpans(text: string, node: MapNode): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const anchor of node.anchors) {
    if (!anchor.trim()) continue;
    let from = 0;
    for (let s = findSpan(text, anchor, from); s; s = findSpan(text, anchor, from)) {
      spans.push({ ...s, refId: node.id });
      from = s.end;
    }
  }
  return dropOverlaps(spans);
}

export const emptyMap = (): WritingMap => ({ version: 1, nodes: [], edges: [] });
