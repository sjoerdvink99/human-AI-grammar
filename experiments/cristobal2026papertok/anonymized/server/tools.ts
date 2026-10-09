/** Deterministic tools (tool_1, tool_2 on the server side). */
import type { Concept } from "./types.ts";

/** tool_1 extract: duration in seconds of a PCM WAV file (r16 -> r17). */
export function wavDuration(buf: Buffer): number {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") {
      if (!byteRate) throw new Error("WAV data before fmt chunk");
      size = Math.min(size, buf.length - off - 8);
      return Math.round((size / byteRate) * 1000) / 1000;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** tool_1 compose: template prompt asking for clarification about a concept (r8 -> r9). */
export function composeClarifyPrompt(concept: Concept): string {
  return [
    `We are about to write the narration script for an explainer video.`,
    `Concept title: ${concept.title}`,
    `Audience: ${concept.audience}`,
    `Hook: ${concept.hook}`,
    `Tone: ${concept.tone}`,
    `Key message: ${concept.keyMessage}`,
    `Outline:\n${concept.outline.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}`,
    `Target length: about ${concept.targetSeconds} seconds of narration.`,
    ``,
    `Before writing, ask the creator the 3 to 5 questions whose answers would most change the script`,
    `(for example emphasis, depth of technical detail, examples to use, call to action).`,
  ].join("\n");
}

/** tool_1 extract (process 7): title / authors / year lines from the paper text (r1 -> r31*). */
export function extractMetadata(paper: string): string[] {
  const lines = paper
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 40);
  const out: string[] = [];
  const absIdx = lines.findIndex((l) => /^abstract\b/i.test(l));
  const head = absIdx > 0 ? lines.slice(0, absIdx) : lines.slice(0, 4);
  const title = head.find((l) => l.length > 8 && l.length < 220);
  if (title) out.push(title);
  const authors = head.find(
    (l) => l !== title && (/,|\band\b/.test(l) || /^[A-Z][a-z]+ [A-Z]/.test(l)) && l.length < 300 && !/@/.test(l),
  );
  if (authors) out.push(authors.replace(/[\d*†‡§]+/g, "").replace(/\s+,/g, ",").trim());
  const year = paper.slice(0, 4000).match(/\b(19|20)\d{2}\b/);
  if (year) out.push(year[0]);
  return out;
}

/** tool_1 compose: title card text from metadata (r31* -> r32). */
export function composeTitleText(metadata: string[]): string {
  return metadata.join("\n");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/** tool_1 compose: title card image = frame (r30) + title text (r32) -> r33 SVG. */
export function composeTitleImage(frameSvg: string | null, text: string): string {
  const [first = "", ...rest] = text.split(/\r?\n/).filter((l) => l.trim());
  const titleLines = wrap(first, 34).slice(0, 4);
  const subLines = rest.flatMap((l) => wrap(l, 70)).slice(0, 4);
  const inner = frameSvg
    ? frameSvg.replace(/<\?xml[^>]*>/, "").replace(/<svg/i, '<svg x="0" y="0"')
    : "";
  let y = 330 - (titleLines.length - 1) * 34;
  const title = titleLines
    .map((l) => {
      const t = `<text x="640" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="60" font-weight="700" fill="#ffffff">${esc(l)}</text>`;
      y += 70;
      return t;
    })
    .join("");
  y += 10;
  const subs = subLines
    .map((l) => {
      const t = `<text x="640" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#e6e9f2">${esc(l)}</text>`;
      y += 42;
      return t;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#1d2440"/>${inner}<rect width="1280" height="720" fill="#0d1226" opacity="0.72"/>${title}${subs}</svg>`;
}
