// tool_3 — ikebana preprocessing.
// ikebana_elements_2 -> [tool_3 translate] -> scribble_map_1 + ikebana_prompt_1
import type { IkebanaCanvas, IkebanaElement } from '../ikebana/types';
import type { ScribbleMap } from '../shared/api';

/** A stem curves gently from the kenzan to the element. */
function stem(origin: [number, number], e: IkebanaElement): [number, number][] {
  const [ox, oy] = origin;
  const pts: [number, number][] = [];
  const bend = (e.x - ox) * 0.25;
  for (let t = 0; t <= 1.0001; t += 0.125) {
    const x = ox + (e.x - ox) * t - bend * Math.sin(Math.PI * t) * 0.4;
    const y = oy + (e.y - oy) * t;
    pts.push([x, y]);
  }
  return pts;
}

export function toScribble(els: IkebanaElement[], canvas: IkebanaCanvas): ScribbleMap {
  const { vase } = canvas;
  const strokes: ScribbleMap['strokes'] = [
    { kind: 'vase outline', points: [[vase.x, vase.y], [vase.x + 12, vase.y + vase.h], [vase.x + vase.w - 12, vase.y + vase.h], [vase.x + vase.w, vase.y], [vase.x, vase.y]] },
  ];
  const circles: ScribbleMap['circles'] = [];
  for (const e of els) {
    const isLeaf = e.kind === 'leaf';
    strokes.push({ kind: `${isLeaf ? 'leaf' : 'flower'} stem (${e.kind})`, points: stem(canvas.origin, e) });
    circles.push({ kind: isLeaf ? 'leaf' : e.kind === 'flower' ? 'flower' : `main flower (${e.kind})`, cx: e.x, cy: e.y, r: e.r * (isLeaf ? 1.4 : 1.6) });
  }
  return { size: canvas.size, strokes, circles };
}

export function scribbleToSvg(s: ScribbleMap): string {
  const lines = s.strokes.map((st) => `<polyline points="${st.points.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="white" stroke-width="3"/>`);
  const circles = s.circles.map((c) => `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${c.r.toFixed(1)}" fill="none" stroke="white" stroke-width="3"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.size} ${s.size}"><rect width="${s.size}" height="${s.size}" fill="black"/>${lines.join('')}${circles.join('')}</svg>`;
}

export function toIkebanaPrompt(els: IkebanaElement[]): string {
  const count = (k: string) => els.filter((e) => e.kind === k).length;
  const shin = els.find((e) => e.kind === 'shin');
  const soe = els.find((e) => e.kind === 'soe');
  const lean = shin && soe ? (soe.x < shin.x ? 'left' : 'right') : 'right';
  const extras = [
    count('flower') ? `${count('flower')} accent flower${count('flower') > 1 ? 's' : ''}` : '',
    count('leaf') ? `${count('leaf')} leaf branch${count('leaf') > 1 ? 'es' : ''}` : '',
  ].filter(Boolean).join(' and ');
  return `A Japanese ikebana arrangement in moribana style in a shallow ceramic vase: a tall shin branch, a soe flower leaning ${lean}, and a short hikae flower leaning the other way${extras ? `, with ${extras}` : ''}. Asymmetric balance, generous empty space, natural light, calm minimal background.`;
}
