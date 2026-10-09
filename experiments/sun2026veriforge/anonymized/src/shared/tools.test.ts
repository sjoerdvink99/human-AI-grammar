import { describe, expect, it } from "vitest";
import {
  addPinsToMap,
  composeAnswerFacts,
  composeDraftContext,
  composeKnowledgeGraph,
  emptyMap,
  findSpan,
  linkMap,
  matchFactSources,
  matchMapToGraph,
  matchNodeSpans,
  matchVectorsToFacts,
  matchVectorsToGraph,
  selectGroundedSpans,
} from "./tools";
import type { Entity, Relation } from "./types";

const entities: Entity[] = [
  { name: "Coral bleaching", type: "phenomenon", description: "loss of algae", docId: "d1" },
  { name: "Marine heatwave", type: "event", description: "warm water", docId: "d1" },
  { name: "Zooxanthellae", type: "organism", description: "algae", docId: "d1" },
  { name: "marine heatwaves", type: "event", description: "", docId: "d2" },
];
const relations: Relation[] = [
  { source: "Marine heatwave", label: "triggers", target: "Coral bleaching", evidence: "Heatwaves trigger bleaching.", docId: "d1" },
  { source: "Coral bleaching", label: "expels", target: "Zooxanthellae", evidence: "", docId: "d1" },
];
const docs = [
  { id: "d1", title: "Doc one", text: "Heatwaves trigger bleaching. Zooxanthellae are algae." },
  { id: "d2", title: "Doc two", text: "Marine heatwaves are increasing." },
];

describe("P1 composeKnowledgeGraph", () => {
  it("merges entities by normalised name and builds edges", () => {
    const kg = composeKnowledgeGraph(entities, relations);
    expect(kg.nodes).toHaveLength(3);
    expect(kg.nodes.find((n) => n.name === "Marine heatwave")!.docIds).toEqual(["d1", "d2"]);
    expect(kg.edges).toHaveLength(2);
  });
});

describe("P2 composeDraftContext", () => {
  it("splits paragraphs with offsets", () => {
    const draft = "First para.\n\nSecond para here.";
    const ctx = composeDraftContext(draft, emptyMap(), 1);
    expect(ctx.paragraphs).toHaveLength(2);
    expect(draft.slice(ctx.paragraphs[1].start, ctx.paragraphs[1].end)).toBe("Second para here.");
    expect(ctx.wordCount).toBe(5);
  });
});

describe("P3 match + select", () => {
  it("matches vectors to KG nodes and finds spans", () => {
    const kg = composeKnowledgeGraph(entities, relations);
    const claims = [{ id: "c1", quote: "warm water bleaches corals", kind: "claim" as const }];
    const scores = kg.nodes.map((n) => (n.name === "Coral bleaching" ? 0.9 : n.name === "Marine heatwave" ? 0.6 : 0.1));
    const g = matchVectorsToGraph(claims, [{ itemId: "c1", scores }], kg);
    expect(g[0].matches.map((m) => m.name)).toEqual(["Coral bleaching", "Marine heatwave"]);
    expect(g[0].edgeIds.length).toBeGreaterThan(0);
    const spans = selectGroundedSpans("In short, warm  water bleaches corals.", g);
    expect(spans[0].text).toBe("warm  water bleaches corals");
  });
  it("findSpan is case-insensitive", () => {
    expect(findSpan("Hello World", "world")?.start).toBe(6);
  });
});

describe("P5 facts", () => {
  it("retrieves facts, composes cited cards and sources", () => {
    const kg = composeKnowledgeGraph(entities, relations);
    const scores = kg.nodes.map((n) => (n.name === "Marine heatwave" ? 0.8 : 0));
    const facts = matchVectorsToFacts([{ id: "q1", text: "heat" }], [{ itemId: "q1", scores }], kg);
    expect(facts[0]).toMatchObject({ id: "F1", kind: "node" });
    const edgeFact = facts.find((f) => f.kind === "edge")!;
    const cards = composeAnswerFacts(`Heat triggers bleaching [${edgeFact.id}].`, facts, kg);
    expect(cards).toHaveLength(1);
    const sources = matchFactSources(cards, kg, docs);
    expect(sources[0]).toMatchObject({ docTitle: "Doc one", snippet: "Heatwaves trigger bleaching." });
  });
});

describe("P6 map linking and P7 spans", () => {
  it("adds pins and links them through the KG", () => {
    const kg = composeKnowledgeGraph(entities, relations);
    const heat = kg.nodes.find((n) => n.name === "Marine heatwave")!.id;
    const zoo = kg.nodes.find((n) => n.name === "Zooxanthellae")!.id;
    const card = { id: "s1", spanText: "corals lose algae", suggestion: "x", nodeIds: [zoo], edgeIds: [] };
    const fact = { id: "f1", factId: "F1", kind: "node" as const, refId: heat, label: "Marine heatwave", text: "t", nodeIds: [heat] };
    const m2 = addPinsToMap(emptyMap(), card, null, kg);
    const m2b = addPinsToMap(m2, null, fact, kg);
    expect(m2b.nodes).toHaveLength(2);
    const links = matchMapToGraph(m2b, kg);
    const m3 = linkMap(m2b, links);
    expect(m3.edges.some((e) => e.label.startsWith("via"))).toBe(true);
    const spans = matchNodeSpans("Every marine heatwave hurts. A marine heatwave again.", m3.nodes[1]);
    expect(spans).toHaveLength(2);
  });
});
