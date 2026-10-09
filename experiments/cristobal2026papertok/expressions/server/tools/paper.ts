// tool_1: deterministic paper parsing — text ingest, page-1 screenshot, author extraction.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { renderSvg, escapeXml, wrap } from "./svg.ts";

const run = promisify(execFile);

export async function pdfToText(pdf: string): Promise<string> {
  const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", pdf, "-"], { maxBuffer: 1 << 26 });
  return stdout;
}

export async function pdfInfo(pdf: string): Promise<Record<string, string>> {
  try {
    const { stdout } = await run("pdfinfo", [pdf]);
    const info: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      const m = line.match(/^([\w ]+):\s+(.*)$/);
      if (m) info[m[1].trim()] = m[2].trim();
    }
    return info;
  } catch {
    return {};
  }
}

/** Guess the title: PDF metadata if meaningful, otherwise the first substantial line. */
export function guessTitle(text: string, metaTitle?: string): string {
  if (metaTitle && metaTitle.length > 8 && !/^(untitled|microsoft word|.*\.(docx?|tex|pdf))/i.test(metaTitle)) return metaTitle;
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 10 && !/^(arxiv|preprint|doi|http)/i.test(l));
  return (line ?? "Untitled paper").replace(/\s{2,}/g, " ").slice(0, 200);
}

const NAME = /^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]*\.?)*\s+[A-Z][\p{L}'’-]+$/u;

/**
 * tool_1 extract (paper_authors_1): author names from PDF metadata, or by scanning the lines
 * between the title and the abstract for name-shaped tokens.
 */
export function extractAuthors(text: string, title: string, metaAuthor?: string): string[] {
  if (metaAuthor && metaAuthor.length > 2) {
    const fromMeta = metaAuthor.split(/\s*(?:,|;|\band\b|&)\s*/).map((s) => s.trim()).filter((s) => s.length > 2);
    if (fromMeta.length) return dedupe(fromMeta);
  }
  const lines = text.split("\n").slice(0, 60);
  const titleIdx = lines.findIndex((l) => title && l.includes(title.slice(0, 20)));
  const absIdx = lines.findIndex((l) => /^\s*(abstract|a b s t r a c t)\b/i.test(l));
  const region = lines.slice(titleIdx >= 0 ? titleIdx + 1 : 0, absIdx > 0 ? absIdx : 25);
  const names: string[] = [];
  for (const line of region) {
    const parts = line
      .replace(/[\d*†‡§¶∗]+/g, " ")
      .split(/\s{2,}|,|;|\band\b|&/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) if (NAME.test(p) && p.split(/\s+/).length <= 4 && !/university|institute|department|lab|school|college/i.test(p)) names.push(p);
  }
  return dedupe(names).slice(0, 12);
}

function dedupe(xs: string[]) {
  return [...new Set(xs)];
}

/** tool_1 extract (paper_screenshot_1): page 1 of the PDF as PNG, or a title card for pasted text. */
export async function paperScreenshot(opts: { pdf?: string; title: string; outPng: string }) {
  if (opts.pdf) {
    const base = opts.outPng.replace(/\.png$/, "");
    await run("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", opts.pdf, base]);
    return;
  }
  const lines = wrap(opts.title, 22).slice(0, 6);
  const text = lines
    .map((l, i) => `<text x="60" y="${200 + i * 70}" font-family="serif" font-size="56" font-weight="bold" fill="#111">${escapeXml(l)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 1100"><rect width="850" height="1100" fill="#fff"/>${text}${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((i) => `<rect x="60" y="${640 + i * 40}" width="${700 - (i % 3) * 90}" height="14" fill="#ddd"/>`)
    .join("")}</svg>`;
  await renderSvg(svg, opts.outPng, 850, 1100);
}
