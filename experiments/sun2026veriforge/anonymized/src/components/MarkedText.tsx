import type { TextSpan } from "../shared/types";

export interface SpanLayer {
  spans: TextSpan[];
  className: string;
  onClick?: (span: TextSpan) => void;
  activeRef?: string | null;
}

/** Renders text with several layers of highlighted spans (selection representations). */
export function MarkedText({ text, layers, decorate }: { text: string; layers: SpanLayer[]; decorate?: (s: string) => React.ReactNode }) {
  const cuts = new Set([0, text.length]);
  for (const l of layers) for (const s of l.spans) if (s.end <= text.length) cuts.add(s.start), cuts.add(s.end);
  const points = [...cuts].sort((a, b) => a - b);
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const seg = text.slice(a, b);
    const hits = layers
      .map((l) => ({ l, s: l.spans.find((s) => s.start <= a && s.end >= b) }))
      .filter((x) => x.s) as { l: SpanLayer; s: TextSpan }[];
    if (!hits.length) {
      parts.push(<span key={a}>{decorate ? decorate(seg) : seg}</span>);
      continue;
    }
    const clickable = hits.find((h) => h.l.onClick);
    const cls = hits.map((h) => h.l.className + (h.l.activeRef && h.s.refId === h.l.activeRef ? " active" : "")).join(" ");
    parts.push(
      <mark key={a} className={cls} onClick={clickable ? () => clickable.l.onClick!(clickable.s) : undefined}>
        {decorate ? decorate(seg) : seg}
      </mark>,
    );
  }
  return <>{parts}</>;
}
