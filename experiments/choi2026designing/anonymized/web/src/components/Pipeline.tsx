export interface PipelineStep {
  label: string;
  actor: string; // the grammar transformation, e.g. "model_1 extract"
}

/** Progress indicator for a chain of transformations. */
export function Pipeline({ steps, current }: { steps: PipelineStep[]; current: number }) {
  return (
    <ol className="pipeline">
      {steps.map((s, i) => (
        <li key={s.label} className={i < current ? "done" : i === current ? "running" : "todo"}>
          <span className="dot">{i < current ? "✓" : i === current ? <span className="spinner" /> : ""}</span>
          {s.label} <code>{s.actor}</code>
        </li>
      ))}
    </ol>
  );
}

/** Renders model prose with simple "-" lists and paragraphs, no markdown library. */
export function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*([-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "")}</li>
              ))}
            </ul>
          );
        return <p key={i}>{b.replace(/\*\*/g, "")}</p>;
      })}
    </div>
  );
}
