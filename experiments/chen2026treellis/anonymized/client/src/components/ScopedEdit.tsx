// Process 5: r12 is the pinned element, r13 the instruction; r14_1 shows what the model will see.
import type { SnippetTarget } from '../App';

export function ScopedEdit({ target, snippet, instruction, onInstruction, busy, onRun, onClose }: {
  target: SnippetTarget;
  snippet: string;
  instruction: string;
  onInstruction: (v: string) => void;
  busy: boolean;
  onRun: () => void;
  onClose: () => void;
}) {
  return (
    <section className="scoped">
      <div className="inspector-head">
        <h2>✦ Edit “{target.nodeId}” with AI</h2>
        <button className="ghost small" disabled={busy} onClick={onClose}>×</button>
      </div>
      <details>
        <summary className="muted small">Code sent to the model (lines {target.startLine}–{target.endLine})</summary>
        <pre className="snippet">{snippet}</pre>
      </details>
      <form onSubmit={(e) => { e.preventDefault(); onRun(); }}>
        <textarea
          autoFocus
          rows={3}
          value={instruction}
          disabled={busy}
          placeholder="e.g. make it rounder and add a shadow"
          onChange={(e) => onInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onRun(); }}
        />
        <button type="submit" className="accent" disabled={busy || !instruction.trim()}>Apply to this element</button>
      </form>
    </section>
  );
}
