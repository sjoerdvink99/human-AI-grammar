import type { SourceImage, SourcePassage, TextItem, VisualElement } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Locate `quote` in `text` exactly, else whitespace/case-insensitively, else by the longest matching word run. */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  if (!quote.trim()) return null;
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  // build normalized text with index map
  const map: number[] = [];
  let nt = "";
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const sp = /\s/.test(ch);
    if (sp && prevSpace) continue;
    nt += sp ? " " : ch.toLowerCase();
    map.push(i);
    prevSpace = sp;
  }
  const nq = norm(quote);
  const idx = nt.indexOf(nq);
  if (idx >= 0) return { start: map[idx], end: map[idx + nq.length - 1] + 1 };
  // fallback: longest run of consecutive quote words found in text
  const words = nq.split(" ");
  for (let len = Math.min(words.length, 12); len >= 3; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const frag = words.slice(i, i + len).join(" ");
      const j = nt.indexOf(frag);
      if (j >= 0) return { start: map[j], end: map[j + frag.length - 1] + 1 };
    }
  }
  return null;
}

/**
 * tool_3 select (process 2): selected element r9 → source passages r10 and linked source images r11*.
 */
export function retrieveProvenance(
  el: VisualElement,
  documents: TextItem[],
  images: SourceImage[],
  context = 220,
): { passages: SourcePassage[]; images: SourceImage[] } {
  const passages = el.sources.map((ref) => {
    const doc = documents.find((d) => d.id === ref.docId);
    if (!doc) return { docId: ref.docId, docTitle: "(missing document)", before: "", match: ref.quote, after: "", found: false };
    const loc = locateQuote(doc.text, ref.quote);
    if (!loc) return { docId: doc.id, docTitle: doc.title, before: "", match: ref.quote, after: "", found: false };
    return {
      docId: doc.id,
      docTitle: doc.title,
      before: (loc.start - context > 0 ? "…" : "") + doc.text.slice(Math.max(0, loc.start - context), loc.start),
      match: doc.text.slice(loc.start, loc.end),
      after: doc.text.slice(loc.end, loc.end + context) + (loc.end + context < doc.text.length ? "…" : ""),
      found: true,
    };
  });
  return { passages, images: linkedImages(el, images) };
}

const STOP = new Set("the a an of and or to in on for with by is are was were at from as that this it be".split(" "));
const terms = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/**
 * Images linked to an element: images attached to a document the element cites, plus any image whose
 * name/caption shares terms with the element. Ranked by term overlap; images of cited documents first.
 */
export function linkedImages(el: VisualElement, images: SourceImage[]): SourceImage[] {
  const cited = new Set(el.sources.map((s) => s.docId));
  const elTerms = terms(`${el.name} ${el.description} ${el.text} ${el.sources.map((s) => s.quote).join(" ")}`);
  return images
    .map((img) => {
      const it = terms(`${img.name} ${img.caption}`);
      let overlap = 0;
      it.forEach((t) => elTerms.has(t) && overlap++);
      return { img, score: (cited.has(img.docId) ? 100 : 0) + overlap };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.img);
}
