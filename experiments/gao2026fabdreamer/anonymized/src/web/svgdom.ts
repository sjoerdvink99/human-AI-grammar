// tool_1 extract (P5 r17→r18, P6 r24→r25): silhouette bounding box of an SVG, measured in the browser.
import type { Box2D, Svg } from "../shared/types";
import { sanitizeSvg, viewBoxOf } from "../shared/tools1";

const SHAPES = "path,rect,circle,ellipse,polygon,polyline,line,use";

export function svgSilhouetteBox(svg: Svg, partId = ""): Box2D | null {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:512px;height:512px;opacity:0;pointer-events:none";
  host.innerHTML = sanitizeSvg(svg);
  document.body.appendChild(host);
  try {
    const root = host.querySelector("svg") as SVGSVGElement | null;
    if (!root) return null;
    root.setAttribute("width", "512"); root.setAttribute("height", "512");
    const vb = viewBoxOf(svg);
    const rootInv = root.getScreenCTM()?.inverse();
    if (!rootInv) return null;
    const found: { x0: number; y0: number; x1: number; y1: number; bg: boolean }[] = [];
    root.querySelectorAll(SHAPES).forEach((node) => {
      const el = node as SVGGraphicsElement;
      if (el.closest("defs,clipPath,mask,pattern,symbol") || el.getAttribute("data-bg")) return;
      const fill = (el.getAttribute("fill") ?? "").toLowerCase();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return;
      let bb: DOMRect;
      try { bb = el.getBBox(); } catch { return; }
      if (bb.width === 0 && bb.height === 0) return;
      const m = el.getScreenCTM();
      if (!m) return;
      const toRoot = rootInv.multiply(m);
      const corners = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(toRoot));
      const cx0 = Math.min(...corners.map((c) => c.x)), cx1 = Math.max(...corners.map((c) => c.x));
      const cy0 = Math.min(...corners.map((c) => c.y)), cy1 = Math.max(...corners.map((c) => c.y));
      const white = fill === "#fff" || fill === "#ffffff" || fill === "white";
      if (white && (cx1 - cx0) * (cy1 - cy0) > vb.w * vb.h * 0.5) return; // white backdrop
      // shapes covering (nearly) the whole canvas are background-like unless nothing else is drawn
      const bg = (cx1 - cx0) >= vb.w * 0.95 && (cy1 - cy0) >= vb.h * 0.95;
      found.push({ x0: cx0, y0: cy0, x1: cx1, y1: cy1, bg });
    });
    const use = found.some((f) => !f.bg) ? found.filter((f) => !f.bg) : found;
    if (!use.length) return null;
    const x0 = Math.min(...use.map((f) => f.x0)), y0 = Math.min(...use.map((f) => f.y0));
    const x1 = Math.max(...use.map((f) => f.x1)), y1 = Math.max(...use.map((f) => f.y1));
    return { partId, x: x0, y: y0, w: x1 - x0, h: y1 - y0, confidence: 1 };
  } finally {
    host.remove();
  }
}
