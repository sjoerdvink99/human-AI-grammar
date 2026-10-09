// tool_3: source alignment and presentation component (deterministic).
import { randomUUID } from "node:crypto";
import type { DraftConcept, Fact, HighlightSpan, KnowledgeCard, TextCardLink, CardOrigin } from "../shared/types.ts";
import { normKey } from "./graphdb.ts";

export const PALETTE = ["#2f7fc1", "#c1522f", "#3a9a5b", "#8a4fbf", "#c19a2f", "#2fa5a5", "#bf4f8a", "#6b7a2f"];

/** Find a phrase in text: exact match first (last occurrence), then case-insensitive. */
export function locate(text: string, phrase: string, before = text.length): { start: number; end: number } | null {
  if (!phrase.trim()) return null;
  let i = text.lastIndexOf(phrase, before);
  if (i < 0) i = text.toLowerCase().lastIndexOf(phrase.toLowerCase(), before);
  return i < 0 ? null : { start: i, end: i + phrase.length };
}

/** [tool_3 select]: candidate_facts* + draft -> highlight_spans* (only phrases that exist in the draft and have source-backed facts) */
export function selectHighlightSpans(
  draft: string, concepts: (DraftConcept & { key: string })[], facts: Fact[], skipTopics: string[] = [], minScore = 0.42,
): HighlightSpan[] {
  const skip = new Set(skipTopics.map(normKey));
  const spans: HighlightSpan[] = [];
  for (const c of concepts) {
    if (skip.has(normKey(c.concept)) || skip.has(normKey(c.phrase))) continue;
    const cf = facts.filter((f) => f.conceptKey === c.key && f.score >= minScore);
    if (!cf.length) continue;
    const loc = locate(draft, c.phrase);
    if (!loc) continue;
    if (spans.some((s) => loc.start < s.end && s.start < loc.end)) continue;
    spans.push({ id: randomUUID().slice(0, 8), start: loc.start, end: loc.end, text: draft.slice(loc.start, loc.end), concept: c.concept, factIds: cf.slice(0, 6).map((f) => f.id) });
  }
  return spans.sort((a, b) => a.start - b.start);
}

function cardFacts(facts: Fact[]) {
  const seen = new Set<string>();
  return facts
    .filter((f) => (seen.has(f.quote) ? false : (seen.add(f.quote), true)))
    .slice(0, 3)
    .map((f) => ({ statement: f.statement, quote: f.quote, docTitle: f.docTitle, passageId: f.passageId }));
}

/** [tool_3 compose]: card_explanation + clicked_span + candidate_facts* -> highlight_card */
export function composeHighlightCard(draft: string, span: HighlightSpan, explanation: string, facts: Fact[]): KnowledgeCard {
  const own = facts.filter((f) => span.factIds.includes(f.id));
  const origin: CardOrigin = {
    kind: "highlight", spanText: span.text, start: span.start, end: span.end,
    contextBefore: draft.slice(Math.max(0, span.start - 40), span.start),
    contextAfter: draft.slice(span.end, span.end + 40),
  };
  return {
    id: randomUUID().slice(0, 8), concept: span.concept, explanation, facts: cardFacts(own),
    entityKeys: [...new Set(own.map((f) => normKey(f.entity)))], origin,
  };
}

/** [tool_3 compose]: query_answer + query_facts* -> query_cards* (one card per query concept with facts) */
export function composeQueryCards(turnId: string, query: string, concepts: { key: string; concept: string }[], facts: Fact[]): KnowledgeCard[] {
  const cards: KnowledgeCard[] = [];
  for (const c of concepts) {
    const cf = facts.filter((f) => f.conceptKey === c.key);
    if (!cf.length) continue;
    const top = cf.filter((f) => f.hop === 0)[0] ?? cf[0];
    cards.push({
      id: randomUUID().slice(0, 8),
      concept: top.hop === 0 ? top.entity : c.concept,
      explanation: cf.filter((f) => f.hop === 0).slice(0, 2).map((f) => f.statement).join(" ") || top.statement,
      facts: cardFacts(cf),
      entityKeys: [...new Set(cf.slice(0, 4).map((f) => normKey(f.entity)))],
      origin: { kind: "query", turnId, query },
      color: PALETTE[cards.length % PALETTE.length],
    });
  }
  return cards;
}

/** [tool_3 match]: query_answer + query_cards* -> text_card_links* (concept mentions in the answer, colored like their card) */
export function linkAnswerToCards(answer: string, cards: KnowledgeCard[]): TextCardLink[] {
  const links: TextCardLink[] = [];
  const lower = answer.toLowerCase();
  for (const card of cards) {
    const terms = [card.concept, ...card.entityKeys]
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 2)
      .sort((a, b) => b.length - a.length);
    for (const term of [...new Set(terms)]) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s)?\\b`, "g");
      for (const m of lower.matchAll(re)) {
        const start = m.index!, end = start + m[0].length;
        if (links.some((l) => start < l.end && l.start < end)) continue;
        links.push({ start, end, cardId: card.id, color: card.color ?? PALETTE[0] });
      }
    }
  }
  return links.sort((a, b) => a.start - b.start);
}
