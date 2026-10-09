import { execFile } from "node:child_process";
import fs from "node:fs/promises";

/** Remove anything from model-written SVG that could execute or load external resources. */
export function sanitizeSvg(svg: string): string {
  const m = svg.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) throw new Error("no <svg> element");
  return m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*"(?!#|data:image\/)[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*'(?!#|data:image\/)[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
}

export function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** Render SVG markup to a PNG of the given size with rsvg-convert. */
export async function renderSvg(svg: string, outPng: string, width: number, height: number) {
  const tmp = outPng.replace(/\.png$/, ".svg");
  await fs.writeFile(tmp, svg);
  await new Promise<void>((resolve, reject) => {
    execFile(process.env.RSVG_BIN ?? "rsvg-convert", ["-w", String(width), "-h", String(height), "-b", "white", "-o", outPng, tmp], (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

/** Wrap text into lines of at most `max` characters. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}
