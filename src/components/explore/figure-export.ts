import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

const svgNamespace = "http://www.w3.org/2000/svg";
const textProperties = ["fill", "font-size", "font-weight", "font-variant-numeric"] as const;
const fallbackFonts = "'IBM Plex Sans', Helvetica, Arial, sans-serif";
const pngSignatureAndHeader = 8 + 25;

export interface SvgSnapshot {
  clone: SVGSVGElement;
  fontFamily: string;
  width: number;
  height: number;
}

export function renderDetached<T>(element: ReactElement, read: (host: HTMLElement) => T): T {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    return read(host);
  } finally {
    root.unmount();
    host.remove();
  }
}

export function snapshotSvg(svg: SVGSVGElement): SvgSnapshot {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = svg.querySelectorAll("*");
  clone.querySelectorAll("*").forEach((element, index) => {
    if (element instanceof SVGTextElement) {
      const computed = getComputedStyle(originals[index]);
      for (const property of textProperties) element.style.setProperty(property, computed.getPropertyValue(property));
    }
    element.removeAttribute("class");
  });
  clone.removeAttribute("class");
  return {
    clone,
    fontFamily: getComputedStyle(svg).fontFamily,
    width: Number(svg.getAttribute("width")),
    height: Number(svg.getAttribute("height")),
  };
}

function familyNames(fontFamily: string): string[] {
  return fontFamily.split(",").map((name) => name.trim().replace(/^["']|["']$/g, ""));
}

function coversAny(unicodeRange: string, codePoints: number[]): boolean {
  if (!unicodeRange) return true;
  return unicodeRange.split(",").some((part) => {
    const [from, to] = part.trim().replace(/^U\+/i, "").split("-");
    const start = parseInt(from.replace(/\?/g, "0"), 16);
    const end = parseInt((to ?? from).replace(/\?/g, "f"), 16);
    return codePoints.some((point) => point >= start && point <= end);
  });
}

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function embeddedFontFaces(fontFamily: string, text: string): Promise<string> {
  const families = new Set(familyNames(fontFamily));
  const codePoints = [...new Set(Array.from(text, (character) => character.codePointAt(0)!))];
  const rules: { css: string; base: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(cssRules)) {
      if (!(rule instanceof CSSFontFaceRule) || !rule.cssText.includes("url(")) continue;
      const family = familyNames(rule.style.getPropertyValue("font-family"))[0];
      if (families.has(family) && coversAny(rule.style.getPropertyValue("unicode-range"), codePoints)) {
        rules.push({ css: rule.cssText, base: sheet.href ?? document.baseURI });
      }
    }
  }
  const inlined = await Promise.all(
    rules.map(async ({ css, base }) => {
      try {
        let result = css;
        for (const [match, url] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          if (!url.startsWith("data:")) result = result.replace(match, `url("${await dataUrl(new URL(url, base).href)}")`);
        }
        return result;
      } catch {
        return "";
      }
    }),
  );
  return inlined.filter(Boolean).join("\n");
}

export async function serializeSvg(snapshot: SvgSnapshot, size: { width: string; height: string }): Promise<string> {
  const svg = snapshot.clone.cloneNode(true) as SVGSVGElement;
  svg.setAttribute("xmlns", svgNamespace);
  svg.setAttribute("viewBox", `0 0 ${snapshot.width} ${snapshot.height}`);
  svg.setAttribute("width", size.width);
  svg.setAttribute("height", size.height);
  svg.style.fontFamily = `${snapshot.fontFamily}, ${fallbackFonts}`;

  const background = document.createElementNS(svgNamespace, "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#ffffff");
  svg.prepend(background);

  const fontFaces = await embeddedFontFaces(snapshot.fontFamily, svg.textContent ?? "");
  if (fontFaces) {
    const style = document.createElementNS(svgNamespace, "style");
    style.textContent = fontFaces;
    svg.prepend(style);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function physicalSizeChunk(dpi: number) {
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set(new TextEncoder().encode("pHYs"), 4);
  view.setUint32(8, pixelsPerMeter);
  view.setUint32(12, pixelsPerMeter);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

export async function svgToPng(svgText: string, width: number, height: number, dpi: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png"),
    );
    const bytes = new Uint8Array(await png.arrayBuffer());
    return new Blob(
      [bytes.subarray(0, pngSignatureAndHeader), physicalSizeChunk(dpi), bytes.subarray(pngSignatureAndHeader)],
      { type: "image/png" },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
