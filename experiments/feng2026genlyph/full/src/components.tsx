import { useMemo, type ReactNode } from 'react';
import { sanitizeInBrowser } from './tools/svg';
import type { Status } from './store';

/** Renders (model-produced) SVG markup after sanitising it in the browser. */
export function SvgView({ svg, className, title }: { svg: string; className?: string; title?: string }) {
  const html = useMemo(() => {
    try {
      const el = sanitizeInBrowser(svg);
      el.removeAttribute('width');
      el.removeAttribute('height');
      return el.outerHTML;
    } catch {
      return '<div class="bad-svg">invalid image</div>';
    }
  }, [svg]);
  return <div className={`svgview ${className ?? ''}`} title={title} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner"><span className="dot" />{label ?? 'Generating…'}</span>;
}

export function StatusLine({ status, error, loading }: { status: Status; error?: string; loading?: string }) {
  if (status === 'loading') return <Spinner label={loading} />;
  if (status === 'error') return <span className="error">⚠ {error}</span>;
  return null;
}

export function Section({ title, hint, children, actions }: { title: string; hint?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Small tag that names the grammar step a control implements. */
export function Step({ children }: { children: ReactNode }) {
  return <code className="gstep">{children}</code>;
}
