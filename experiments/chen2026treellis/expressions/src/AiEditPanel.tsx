// Process 5: shows ai_target_1 and its subtree_1, takes local_request_1 (human specify).
import type { SceneNode } from '../shared/scene';

interface Props {
  target: SceneNode | undefined;
  subtree: string;
  request: string;
  busy: boolean;
  onRequestChange: (s: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}

export function AiEditPanel({ target, subtree, request, busy, onRequestChange, onSubmit, onClear }: Props) {
  if (!target)
    return (
      <div className="empty">
        Click <b>✦</b> on a row of the structure tree to ask the AI to change only that part.
      </div>
    );
  return (
    <div className="ai-edit">
      <div className="ai-target-head">
        <span>Target: <b>{target.name}</b> <span className="type">{target.type}</span></span>
        <button className="link" onClick={onClear} disabled={busy}>clear</button>
      </div>
      <details>
        <summary>Code sent to the model ({subtree.split('\n').length - 1} lines)</summary>
        <pre className="subtree">{subtree}</pre>
      </details>
      <textarea
        rows={3}
        placeholder={`e.g. "make it twice as tall", "add armrests", "make it look more modern"`}
        value={request}
        disabled={busy}
        onChange={(e) => onRequestChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
        }}
      />
      <button className="primary" onClick={onSubmit} disabled={busy || !request.trim()}>
        {busy ? <><span className="spinner" /> Editing “{target.name}”…</> : `Apply to “${target.name}”`}
      </button>
    </div>
  );
}
