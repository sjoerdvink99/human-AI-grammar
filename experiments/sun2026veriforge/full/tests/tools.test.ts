import { describe, expect, it } from "vitest";
import { GraphDB, exactQuote } from "../server/graphdb.ts";
import { splitPassages } from "../server/ingest.ts";
import { embed, cosine } from "../server/embed.ts";
import { composeHighlightCard, composeQueryCards, linkAnswerToCards, selectHighlightSpans } from "../server/align.ts";
import { composeSemanticFrame } from "../server/context.ts";
import { locateOriginSpan, reanchor } from "../web/src/align.ts";
import { addCardToCanvas, mergeRelatedEdges } from "../web/src/canvasOps.ts";

const TEXT = `The sextant is a navigation instrument used to measure the angle between a celestial body and the horizon. Navigators used the sextant to find latitude.

A chronometer is a precise clock carried aboard ship. The marine chronometer allowed navigators to determine longitude.`;

async function buildDb() {
  const db = new GraphDB();
  const ps = splitPassages("d1", "Navigation Handbook", TEXT);
  db.addDocument({ id: "d1", title: "Navigation Handbook", charCount: TEXT.length, passageIds: ps.map((p) => p.id) }, ps);
  await db.compose(
    [
      { name: "Sextant", type: "instrument", description: "A navigation instrument measuring angles to the horizon.", passageId: ps[0].id, evidence: "Navigators used the sextant to find latitude." },
      { name: "Latitude", type: "concept", description: "North-south position.", passageId: ps[0].id, evidence: "not in text" },
      { name: "Marine chronometer", type: "instrument", description: "A precise ship's clock used for longitude.", passageId: ps[0].id, evidence: "A chronometer is a precise clock carried aboard ship." },
    ],
    [{ source: "Sextant", target: "Latitude", label: "is used to find", passageId: ps[0].id, evidence: "Navigators used the sextant to find latitude." }],
  );
  return { db, ps };
}

describe("process 1 tools", () => {
  it("splits passages and keeps quotes exact", async () => {
    const { db, ps } = await buildDb();
    expect(ps.length).toBe(1);
    expect(db.stats().entityCount).toBe(3);
    const q = exactQuote(ps[0], "invented quote", "latitude");
    expect(ps[0].text.includes(q)).toBe(true);
  });
});

describe("process 3 / 5 retrieval", () => {
  it("embeds similar terms closer", async () => {
    const [a, b, c] = await embed(["sextant", "the sextant instrument", "banana bread"]);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });

  it("matches concepts and walks hops", async () => {
    const { db } = await buildDb();
    const [v] = await embed(["sextant"]);
    const facts = db.match([{ key: "c0", text: "sextant", vector: v }], 1);
    expect(facts[0].entity).toBe("Sextant");
    expect(facts.some((f) => f.relation?.label === "is used to find")).toBe(true);
  });

  it("selects spans only for phrases in the draft with facts", async () => {
    const { db } = await buildDb();
    const draft = "Mara lifted the sextant toward the noon sun.";
    const concepts = [
      { key: "c0", phrase: "sextant", concept: "Sextant", reason: "" },
      { key: "c1", phrase: "astrolabe", concept: "Astrolabe", reason: "" },
    ];
    const vecs = await embed(concepts.map((c) => c.concept));
    const facts = db.match(concepts.map((c, i) => ({ key: c.key, text: c.concept, vector: vecs[i] })), 1);
    const spans = selectHighlightSpans(draft, concepts, facts);
    expect(spans).toHaveLength(1);
    expect(draft.slice(spans[0].start, spans[0].end)).toBe("sextant");
    expect(selectHighlightSpans(draft, concepts, facts, ["Sextant"])).toHaveLength(0);

    const card = composeHighlightCard(draft, spans[0], "explained", facts);
    expect(card.origin.kind).toBe("highlight");
    expect(card.facts.length).toBeGreaterThan(0);
  });

  it("links answer text to query cards", async () => {
    const { db } = await buildDb();
    const [v] = await embed(["sextant"]);
    const facts = db.match([{ key: "q0", text: "sextant", vector: v }], 2);
    const cards = composeQueryCards("t1", "what is a sextant", [{ key: "q0", concept: "sextant" }], facts);
    const links = linkAnswerToCards("A Sextant measures angles; sextants find latitude.", cards);
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links[0].cardId).toBe(cards[0].id);
  });
});

describe("processes 2, 6, 7", () => {
  it("composes a semantic frame from draft and canvas", () => {
    const f = composeSemanticFrame("The sextant gleamed. The sextant was old.", { nodes: [], edges: [] });
    expect(f.salientTerms[0]).toBe("sextant");
  });

  it("keeps spans anchored and finds origin spans", () => {
    const spans = [{ id: "a", start: 4, end: 11, text: "sextant", concept: "Sextant", factIds: [] }];
    const edited = "Old sextant here".replace("Old", "The old");
    expect(reanchor(edited, spans)[0].start).toBe(8);
    const loc = locateOriginSpan("Intro. The sextant gleamed.", { kind: "highlight", spanText: "sextant", start: 4, end: 11, contextBefore: "The ", contextAfter: " gleamed" });
    expect(loc).toEqual({ start: 11, end: 18 });
  });

  it("adds gold/silver nodes and merges related edges", () => {
    const base = { id: "k", concept: "x", explanation: "", facts: [], entityKeys: [] };
    let c = addCardToCanvas({ nodes: [], edges: [] }, { ...base, id: "a", origin: { kind: "highlight", spanText: "", start: 0, end: 0, contextBefore: "", contextAfter: "" } });
    c = addCardToCanvas(c, { ...base, id: "b", origin: { kind: "query", turnId: "t", query: "q" } });
    expect(c.nodes.map((n) => n.tone)).toEqual(["gold", "silver"]);
    c = mergeRelatedEdges(c, [{ id: "e", source: "n-a", target: "n-b", label: "rel", auto: true }]);
    expect(c.edges).toHaveLength(1);
  });
});
