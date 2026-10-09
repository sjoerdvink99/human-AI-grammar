import type { ReactNode } from "react";
import type { Box2D, BoxCheck, Svg } from "../../shared/types";
import { useApp } from "../store";

export const svgUrl = (svg: Svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function SvgImage({ svg, size = 200, className = "", onClick, title }: { svg: Svg; size?: number; className?: string; onClick?: () => void; title?: string }) {
  return (
    <img src={svgUrl(svg)} width={size} height={size} className={`svgimg ${className} ${onClick ? "clickable" : ""}`}
      onClick={onClick} title={title} alt={title ?? "image"} />
  );
}

const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46a5a5", "#f032e6", "#9a6324", "#808000", "#000075", "#e6a800", "#2f4f4f"];
export const colorFor = (i: number) => PALETTE[i % PALETTE.length];

/** Image with labelled boxes drawn on top (selection spatial shown on the visual it refers into). */
export function BoxOverlay({ svg, boxes, labels, checks, size = 420, dashed }: {
  svg: Svg; boxes: Box2D[]; labels: Record<string, string>; checks?: BoxCheck[]; size?: number; dashed?: Box2D[];
}) {
  const ids = Object.keys(labels);
  return (
    <div className="overlay" style={{ width: size, height: size }}>
      <SvgImage svg={svg} size={size} />
      <svg viewBox="0 0 512 512" width={size} height={size} className="overlay-svg">
        {dashed?.map((b) => (
          <rect key={`d-${b.partId}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#999" strokeDasharray="6 4" strokeWidth={1.5} />
        ))}
        {boxes.map((b) => {
          const i = Math.max(0, ids.indexOf(b.partId));
          const fail = checks?.find((c) => c.partId === b.partId && !c.pass);
          return (
            <g key={b.partId}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={colorFor(i)} fillOpacity={0.08} stroke={fail ? "#d00" : colorFor(i)} strokeWidth={fail ? 3 : 2} />
              <text x={b.x + 3} y={b.y + 13} fontSize={12} fill={colorFor(i)} fontWeight={600} paintOrder="stroke" stroke="#fff" strokeWidth={3}>
                {labels[b.partId] ?? b.partId}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Status({ k }: { k: string }) {
  const busy = useApp((s) => s.busy[k]);
  const err = useApp((s) => s.errors[k]);
  if (busy) return <div className="status busy"><span className="spinner" /> {busy}</div>;
  if (err) return <div className="status error">⚠ {err}</div>;
  return null;
}

export function Step({ id, actor, title, children, done }: { id: string; actor: string; title: string; children?: ReactNode; done?: boolean }) {
  return (
    <section className={`step ${done ? "done" : ""}`}>
      <header>
        <span className={`actor actor-${actor.split("_")[0]}`}>{actor}</span>
        <h3>{title}</h3>
        <code className="ids">{id}</code>
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function DimInputs({ value, onChange }: { value: { w: number; h: number; d: number }; onChange: (v: { w: number; h: number; d: number }) => void }) {
  return (
    <span className="dims">
      {(["w", "h", "d"] as const).map((k) => (
        <label key={k}>{k}
          <input type="number" value={Math.round(value[k] * 10) / 10} min={0.5}
            onChange={(e) => onChange({ ...value, [k]: Math.max(0.5, Number(e.target.value) || 0.5) })} />
        </label>
      ))}
      <small>mm</small>
    </span>
  );
}

export function download(name: string, content: string, mime = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name.split("/").pop() ?? name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
