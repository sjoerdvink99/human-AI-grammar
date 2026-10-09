import { useState } from 'react';

export async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}

export const svgUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

/** Show a generated SVG as an image (isolated: no scripts, no style leakage). */
export function SvgImage({ svg, size, alt, checker }: { svg: string; size?: number; alt: string; checker?: boolean }) {
  return (
    <img
      className={checker ? 'checker' : undefined}
      src={svgUrl(svg)}
      alt={alt}
      style={{ width: size ?? '100%', height: size ?? 'auto', display: 'block' }}
    />
  );
}

/** Loading / error state for a generative (~) step. */
export function GenStatus({ busy, error, label }: { busy: boolean; error: string | null; label: string }) {
  if (busy) return <div className="status busy"><span className="spinner" /> {label}… (model call, usually 20–90 s)</div>;
  if (error) return <div className="status error">⚠ {error}</div>;
  return null;
}

/** A small async runner for generative steps. */
export function useGen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Earlier versions of a generated artifact, kept for comparison and revert. */
export function VersionStrip({ versions, current, onPick }: { versions: { label: string; svg: string }[]; current: number; onPick: (i: number) => void }) {
  if (versions.length < 2) return null;
  return (
    <div className="versions">
      {versions.map((v, i) => (
        <button key={i} className={i === current ? 'version active' : 'version'} onClick={() => onPick(i)} title={v.label}>
          <SvgImage svg={v.svg} size={56} alt={v.label} />
          <span>{v.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Step({ n, title, active, done, children }: { n: number | string; title: string; active: boolean; done?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
      <div className="step-head"><span className="step-n">{done ? '✓' : n}</span>{title}</div>
      {active && <div className="step-body">{children}</div>}
    </div>
  );
}
