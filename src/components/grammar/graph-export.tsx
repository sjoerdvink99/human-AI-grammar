"use client";

import { ImageDown } from "lucide-react";

const scale = 4;
const padding = 12;
const properties = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linejoin",
  "paint-order",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
];

const unquote = (family: string) => family.replace(/["']/g, "").trim();

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

// An SVG drawn as an image cannot reach the page's web fonts, so the faces it uses are inlined.
async function fontFaces(families: Set<string>) {
  const rules = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch {
        return [];
      }
    })
    .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule && families.has(unquote(rule.style.getPropertyValue("font-family"))));
  const faces = await Promise.all(
    rules.map(async (rule) => {
      const source = /url\(["']?([^"')]+)/.exec(rule.style.getPropertyValue("src"))?.[1];
      if (!source) return "";
      const response = await fetch(new URL(source, rule.parentStyleSheet?.href ?? location.href));
      return rule.cssText.replace(/url\([^)]*\)/, `url(${await dataUrl(await response.blob())})`);
    }),
  );
  return faces.join("\n");
}

async function exportGraph(svg: SVGSVGElement, fileName: string) {
  const box = svg.getBBox();
  const [x, y, width, height] = [box.x - padding, box.y - padding, box.width + padding * 2, box.height + padding * 2];
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const targets = [clone, ...clone.querySelectorAll("*")];
  const families = new Set<string>();
  [svg, ...svg.querySelectorAll("*")].forEach((source, index) => {
    const computed = getComputedStyle(source);
    targets[index].removeAttribute("class");
    targets[index].setAttribute("style", properties.map((property) => `${property}:${computed.getPropertyValue(property)}`).join(";"));
    computed.fontFamily.split(",").forEach((family) => families.add(unquote(family)));
  });
  clone.querySelectorAll("title").forEach((title) => title.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = await fontFaces(families);
  clone.prepend(style);

  const image = new Image();
  image.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  await image.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.ceil(width * scale), height: Math.ceil(height * scale) });
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(image.src);
  Object.assign(document.createElement("a"), { download: fileName, href: canvas.toDataURL("image/png") }).click();
}

/** Saves the graph of the surrounding `data-graph-card` as a high-resolution PNG. */
export function ExportButton({ fileName }: { fileName: string }) {
  return (
    <button
      type="button"
      aria-label="Export graph as image"
      title="Export graph as PNG"
      onClick={(event) => {
        const svg = event.currentTarget.closest("[data-graph-card]")?.querySelector<SVGSVGElement>("svg[data-graph]");
        if (svg) exportGraph(svg, fileName);
      }}
      className="rounded p-0.5 text-faint transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
    >
      <ImageDown className="size-3.5" />
    </button>
  );
}
