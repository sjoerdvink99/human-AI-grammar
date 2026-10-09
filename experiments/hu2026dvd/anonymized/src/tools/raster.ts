import type { ClickPoint, Point, Rect } from "../../shared/types";
import { polygonBounds } from "../../shared/pictorial";

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/** Rasterize an SVG document to a canvas of its own size. */
export async function rasterize(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(svgDataUrl(svg));
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.drawImage(img, 0, 0, width, height);
  return c;
}

/** r19: crop a rectangle out of a rasterized scene, upscaled so the model sees detail. */
export function cropCanvas(src: HTMLCanvasElement, r: Rect, scale = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(r.w * scale));
  c.height = Math.max(1, Math.round(r.h * scale));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

/** Copy of the crop with a 10% grid and the click points drawn, to help the model localize. */
export function annotate(crop: HTMLCanvasElement, points: ClickPoint[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = crop.width;
  c.height = crop.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(crop, 0, 0);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.font = "10px sans-serif";
  for (let i = 1; i < 10; i++) {
    const x = (c.width * i) / 10;
    const y = (c.height * i) / 10;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
    ctx.fillText(`.${i}`, x + 2, 10);
    ctx.fillText(`.${i}`, 2, y - 2);
  }
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = p.positive ? "#1db954" : "#e63946";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  return c;
}

/** tool_5 modify: apply the object mask r21 to the crop → cutout r22 (transparent PNG, trimmed to the mask). */
export function applyMask(crop: HTMLCanvasElement, polygon: Point[]): { dataUrl: string; width: number; height: number } {
  const b = polygonBounds(polygon);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b.w));
  c.height = Math.max(1, Math.round(b.h));
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  polygon.forEach((p, i) => (i ? ctx.lineTo(p.x - b.x, p.y - b.y) : ctx.moveTo(p.x - b.x, p.y - b.y)));
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(crop, -b.x, -b.y);
  return { dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height };
}

export function download(name: string, content: string, mime = "image/svg+xml") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}
