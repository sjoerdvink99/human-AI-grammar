// Typed representations from design.json. Names follow the design identifiers (version suffix dropped).

/** (source_documents_1: artifact language)* */
export interface SourceDocument {
  id: string;
  title: string;
  text: string;
}

/** (domain_entities_1: artifact record)* */
export interface DomainEntity {
  id: string;
  name: string;
  type: string;
  description: string;
  aliases: string[];
  sourceDocIds: string[];
}

/** (domain_relations_1: artifact record)* */
export interface DomainRelation {
  id: string;
  source: string; // entity id
  target: string; // entity id
  predicate: string;
  evidence: string;
  sourceDocId: string;
}

/** (knowledge_graph_1: artifact graph) */
export interface KnowledgeGraph {
  nodes: DomainEntity[];
  links: DomainRelation[];
  documents: { id: string; title: string }[];
  builtAt: string;
}

/** (semantic_frame_1: artifact record) — composed by tool_2 from draft + canvas */
export interface SemanticFrame {
  focus: string;
  keyTerms: string[];
  canvasEntities: string[];
  canvasRelations: string[];
  wordCount: number;
}

/** (draft_concepts_1 | query_concepts_1: artifact record)* */
export interface Concept {
  mention: string; // surface form (verbatim in draft for draft concepts)
  concept: string; // normalized concept name
}

/** (candidate_facts_1 | query_facts_1: artifact record)* */
export interface Fact {
  id: string; // F1, F2 … unique within one analysis / one query
  mention: string;
  entityId: string;
  entityName: string;
  entityType: string;
  description: string;
  statements: string[]; // human-readable relation triples
  relationIds: string[];
  score: number;
  sourceDocIds: string[];
}

/** (highlight_spans_1: selection language)* and (clicked_span_1) */
export interface HighlightSpan {
  id: string;
  start: number;
  end: number;
  text: string;
  factIds: string[];
}

/** (highlight_card_1: artifact record) */
export interface HighlightCard {
  id: string;
  kind: 'highlight';
  span: HighlightSpan;
  title: string;
  explanation: string;
  facts: Fact[];
  createdAt: string;
}

/** (query_cards_1: artifact record)* */
export interface QueryCard {
  id: string;
  kind: 'query';
  turnId: string;
  title: string;
  facts: Fact[];
  createdAt: string;
}

export type Card = HighlightCard | QueryCard;

/** (text_card_links_1: artifact record)* */
export interface TextCardLink {
  cardId: string;
  start: number;
  end: number;
}

/** One question/answer round: query_1, query_answer_1, query_facts_1, query_cards_1, text_card_links_1 */
export interface ChatTurn {
  id: string;
  query: string;
  status: 'pending' | 'done' | 'error';
  answer?: string;
  facts?: Fact[];
  cardIds?: string[];
  links?: TextCardLink[];
  error?: string;
}

/** Nodes of (canvas_n: artifact graph). gold = from highlight card, silver = from query card. */
export interface CanvasNode {
  id: string;
  kind: 'gold' | 'silver';
  cardId: string;
  title: string;
  entityIds: string[];
  position: { x: number; y: number };
}

/** Edges of (canvas_n) / (related_edges_1: artifact graph) */
export interface CanvasEdge {
  id: string;
  source: string; // canvas node id
  target: string;
  label: string;
  relationIds: string[];
  hops: 1 | 2;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** API payloads */
export interface AnalyzeResponse {
  concepts: Concept[];
  facts: Fact[];
  spans: HighlightSpan[];
}

export interface AskResponse {
  concepts: Concept[];
  facts: Fact[];
  answer: string;
}
