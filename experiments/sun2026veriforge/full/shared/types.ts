// Typed representations, named after the design's identifiers (without version).

/** source_documents: reference books or other domain texts the author uploads */
export interface SourceDocument {
  id: string;
  title: string;
  charCount: number;
  passageIds: string[];
}

/** A passage of a source document; every entity/relation/fact points back to one. */
export interface Passage {
  id: string;
  docId: string;
  docTitle: string;
  index: number;
  text: string;
}

/** domain_entities: entities extracted from the source documents, each tied to its passage */
export interface DomainEntity {
  name: string;
  type: string;
  description: string;
  passageId: string;
  /** verbatim sentence from the passage supporting the entity */
  evidence: string;
}

/** domain_relations: relationships between entities, each tied to its passage */
export interface DomainRelation {
  source: string;
  target: string;
  label: string;
  passageId: string;
  evidence: string;
}

/** A node of knowledge_graph */
export interface GraphEntity {
  key: string; // normalized name
  name: string;
  type: string;
  descriptions: { text: string; passageId: string; evidence: string }[];
  vector: number[];
}

export interface GraphRelation {
  source: string; // entity key
  target: string; // entity key
  label: string;
  passageId: string;
  evidence: string;
}

/** semantic_frame: summary of the current writing context, built from draft + canvas */
export interface SemanticFrame {
  version: number;
  focusExcerpt: string;
  salientTerms: string[];
  canvasTopics: string[];
  canvasRelations: string[];
  draftLength: number;
  updatedAt: string;
}

/** draft_concepts: domain concepts found in the current draft */
export interface DraftConcept {
  phrase: string; // verbatim phrase from the draft
  concept: string; // canonical concept name
  reason: string;
}

/** query_concepts */
export interface QueryConcept {
  concept: string;
}

/** candidate_facts / query_facts: source-backed facts from the graph */
export interface Fact {
  id: string;
  conceptKey: string; // the draft/query concept this fact answers
  entity: string;
  statement: string;
  relation?: { source: string; label: string; target: string };
  passageId: string;
  quote: string; // exact text from the passage
  docTitle: string;
  score: number;
  hop: number;
}

/** highlight_spans / clicked_span */
export interface HighlightSpan {
  id: string;
  start: number;
  end: number;
  text: string;
  concept: string;
  factIds: string[];
}

export type CardOrigin =
  | { kind: "highlight"; spanText: string; start: number; end: number; contextBefore: string; contextAfter: string }
  | { kind: "query"; turnId: string; query: string };

/** highlight_card / query_cards */
export interface KnowledgeCard {
  id: string;
  concept: string;
  explanation: string;
  facts: { statement: string; quote: string; docTitle: string; passageId: string }[];
  entityKeys: string[];
  origin: CardOrigin;
  color?: string;
}

/** text_card_links */
export interface TextCardLink {
  start: number;
  end: number;
  cardId: string;
  color: string;
}

export interface QueryTurn {
  id: string;
  query: string;
  answer: string;
  cards: KnowledgeCard[];
  links: TextCardLink[];
  facts: Fact[];
  createdAt: string;
}

/** canvas: saved knowledge cards as nodes with labeled connections */
export interface CanvasNode {
  id: string;
  tone: "gold" | "silver";
  card: KnowledgeCard;
  x: number;
  y: number;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  auto: boolean;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface GraphStats {
  documents: SourceDocument[];
  entityCount: number;
  relationCount: number;
  passageCount: number;
}

export interface IngestJob {
  id: string;
  status: "running" | "done" | "error";
  total: number;
  done: number;
  message: string;
}
