import { escapeXml } from "./sanitize";
import type { Scene, SceneLayer, SceneSpec } from "./types";

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function renderLayer(l: SceneLayer): string {
  const attrs = `data-element-id="${escapeXml(l.elementId)}"`;
  if (l.kind === "headline" || l.kind === "text" || l.kind === "annotation") {
    const size = l.kind === "headline" ? Math.max(18, Math.min(48, l.h * 0.45)) : l.kind === "text" ? 16 : 13;
    const maxChars = Math.max(6, Math.floor(l.w / (size * 0.6)));
    const lines = wrap(l.text || "", maxChars);
    const weight = l.kind === "headline" ? 700 : 400;
    const style = l.kind === "annotation" ? ` font-style="italic"` : "";
    const tspans = lines
      .map((ln, i) => `<tspan x="${l.x}" dy="${i === 0 ? size : size * 1.2}">${escapeXml(ln)}</tspan>`)
      .join("");
    const rule =
      l.kind === "annotation"
        ? `<line x1="${l.x - 6}" y1="${l.y}" x2="${l.x - 6}" y2="${l.y + l.h}" stroke="${l.color}" stroke-width="2"/>`
        : "";
    return `<g ${attrs}><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="transparent"/>${rule}<text x="${l.x}" y="${l.y}" fill="${l.color}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}"${style}>${tspans}</text></g>`;
  }
  const inner = l.svg || `<rect x="5" y="5" width="90" height="90" rx="12" fill="${l.color}" opacity="0.85"/>`;
  return `<g ${attrs}><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="transparent"/><svg x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" viewBox="0 0 100 100" preserveAspectRatio="${l.kind === "shape" ? "none" : "xMidYMid meet"}" overflow="visible">${inner}</svg></g>`;
}

/** tool_2 execute: scene spec r5 → rendered scene r6 (standalone SVG document). */
export function renderScene(spec: SceneSpec): Scene {
  const body = spec.layers.map(renderLayer).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}"><rect width="100%" height="100%" fill="${spec.background}"/>\n${body}\n</svg>`;
  return { svg, width: spec.width, height: spec.height };
}
