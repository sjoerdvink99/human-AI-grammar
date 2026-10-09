import type { ReactNode } from "react";

export function SvgView({ svg, className = "", onClick }: { svg: string; className?: string; onClick?: () => void }) {
  return <div className={`svgbox ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner">
      <span className="dot" /> {label ?? "Generating…"}
    </div>
  );
}

export function Panel({ title, tag, children, actions }: { title: string; tag?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h3>
          {title} {tag && <code className="tag">{tag}</code>}
        </h3>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="error">
      {msg} {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}
