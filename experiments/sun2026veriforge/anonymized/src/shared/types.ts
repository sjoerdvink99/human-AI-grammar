// Representations of the design. Each type is named after its identifier (see PLAN.md).

/** r1 — (r1_1: artifact language)* */
export interface SourceDocument {
  id: string;
  title: string;
  text: string;
}

/** r2 — (r2_1: artifact record)* */
export interface Entity {
  name: string;
  type: string;
  description: string;
  docId: string;
}

/** r3 — (r3_1: artifact record)* */
export interface Relation {
  source: string;
  label: string;
  target: string;
  evidence: string;
  docId: string;
}

export interface KGNode {
  id: string;
  name: string;
  type: string;
  description: string;
  docIds: string[];
}

export interface KGEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  label: string;
  evidence: string[];
  docIds: string[];
}

/** r4 — (r4_1: artifact graph); also r24 (KG sub-graph linking map nodes) */
export interface KnowledgeGraph {
  nodes: KGNode[];
  edges: KGEdge[];
}

/** r6 — (r6: artifact graph): the user's writing map */
export type MapNodeKind = "suggestion" | "fact" | "concept";
export interface MapNode {
  id: string;
  label: string;
  kind: MapNodeKind;
  text: string;
  /** KG node ids this map node refers to (used by tool_1 match). */
  kgNodeIds: string[];
  /** Phrases used to find the node in the draft or answer (P7, P8). */
  anchors: string[];
}
export interface MapEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  origin: "pin" | "kg";
}
export interface WritingMap {
  version: number;
  nodes: MapNode[];
  edges: MapEdge[];
}

/** r7 — (r7: artifact record) */
export interface DraftContext {
  wordCount: number;
  paragraphs: { index: number; start: number; end: number; text: string }[];
  mapConcepts: string[];
  draftVersion: number;
}

/** r8 — (r8_1: artifact record)* */
export interface DraftClaim {
  id: string;
  quote: string;
  kind: "claim" | "concept";
}

/** r16 — (r16_1: artifact record)* */
export interface QueryTerm {
  id: string;
  text: string;
}

/** r9, r17 — (artifact numeric)*: one relevance vector over KG nodes per item */
export interface ItemVector {
  itemId: string;
  scores: number[]; // aligned with knowledgeGraph.nodes order
}

/** r10 — (r10_1: artifact record)* */
export interface Grounding {
  claimId: string;
  quote: string;
  matches: { nodeId: string; name: string; score: number }[];
  edgeIds: string[];
}

/** r11, r12, r26, r28 — (selection language) */
export interface TextSpan {
  start: number;
  end: number;
  text: string;
  refId?: string;
}

/** r14 — (r14_1: artifact record) */
export interface SuggestionCard {
  id: string;
  spanText: string;
  suggestion: string;
  nodeIds: string[];
  edgeIds: string[];
}

/** r18 — (r18_1: artifact record)* */
export interface KGFact {
  id: string; // F1, F2…
  kind: "node" | "edge";
  refId: string; // KG node or edge id
  text: string;
  score: number;
}

/** r20 — (r20_1: artifact record)* */
export interface AnswerFact {
  id: string;
  factId: string;
  kind: "node" | "edge";
  refId: string;
  label: string;
  text: string;
  nodeIds: string[];
}

/** r21 — (r21_1: artifact record)* */
export interface FactSource {
  factId: string;
  docId: string;
  docTitle: string;
  snippet: string;
}

// API payloads
export interface BuildGraphResponse {
  entities: Entity[];
  relations: Relation[];
  knowledgeGraph: KnowledgeGraph;
}
export interface GroundResponse {
  draftClaims: DraftClaim[];
  claimVectors: ItemVector[];
  groundings: Grounding[];
  groundedSpans: TextSpan[];
}
export interface SuggestResponse {
  suggestion: string;
  suggestionCard: SuggestionCard;
}
export interface AskResponse {
  questionTerms: QueryTerm[];
  questionVectors: ItemVector[];
  retrievedFacts: KGFact[];
  answer: string;
  answerFacts: AnswerFact[];
  answerSources: FactSource[];
}
