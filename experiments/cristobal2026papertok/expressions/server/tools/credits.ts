// tool_1 compose: credit text and credit scene (process 7).
import fs from "node:fs/promises";
import { renderSvg, escapeXml, wrap } from "./svg.ts";
import { WIDTH, HEIGHT } from "./media.ts";

/** tool_1 compose (credit_text_1) from paper_authors_1. */
export function composeCreditText(title: string, authors: string[]): string {
  const who =
    authors.length === 0 ? "the original authors" : authors.length <= 2 ? authors.join(" and ") : `${authors.slice(0, -1).join(", ")}, and ${authors.at(-1)}`;
  return `Based on the paper “${title}” by ${who}.`;
}

/** tool_1 compose (credit_scene_1): paper screenshot + credit text on a vertical card. */
export async function composeCreditScene(screenshotPng: string, creditText: string, outPng: string) {
  const b64 = (await fs.readFile(screenshotPng)).toString("base64");
  const lines = wrap(creditText, 30).slice(0, 7);
  const text = lines
    .map((l, i) => `<text x="${WIDTH / 2}" y="${930 + i * 46}" font-family="sans-serif" font-size="34" fill="#f8fafc" text-anchor="middle">${escapeXml(l)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0f172a"/>
  <rect x="104" y="84" width="512" height="700" rx="10" fill="#000" opacity="0.4"/>
  <image x="96" y="76" width="512" height="700" preserveAspectRatio="xMidYMin slice" href="data:image/png;base64,${b64}" xlink:href="data:image/png;base64,${b64}"/>
  <rect x="96" y="76" width="512" height="700" fill="none" stroke="#e2e8f0" stroke-width="2"/>
  <text x="${WIDTH / 2}" y="860" font-family="sans-serif" font-size="28" fill="#94a3b8" text-anchor="middle" letter-spacing="4">SOURCE</text>
  ${text}
</svg>`;
  await renderSvg(svg, outPng, WIDTH, HEIGHT);
}
