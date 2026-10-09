// local_request: [human specify] a change to the selected node (ai_target) for process 5.
import { useState } from 'react';
import type { SceneNode } from '../shared/scene';

interface Props {
  target: SceneNode | null;
  busy: boolean;
  running: boolean;
  onSubmit: (request: string) => Promise<boolean>;
}

const EXAMPLES = ['make it taller', 'add decorative details', 'make it look more modern', 'split into two parts'];

export function LocalEditBox({ target, busy, running, onSubmit }: Props) {
  const [text, setText] = useState('');
  const submit = async () => {
    if (!target || !text.trim() || busy) return;
    if (await onSubmit(text)) setText('');
  };
  return (
    <div className="panel ai-panel">
      <div className="panel-title">AI edit selected node</div>
      {target ? (
        <div className="ai-target">
          Scope: <b>{target.name}</b> <span className="muted">({target.kind === 'group' ? `subassembly, ${target.children.length} children` : 'part'})</span>
        </div>
      ) : (
        <div className="empty">Select a node to edit only that region with AI.</div>
      )}
      <textarea
        rows={3}
        placeholder={target ? `Describe a change to “${target.name}”…` : 'Select a node first'}
        value={text}
        disabled={!target || busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="chips">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" disabled={!target || busy} onClick={() => setText(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <button className="primary" disabled={!target || !text.trim() || busy} onClick={submit}>
        {running ? 'Editing region…' : 'Apply to this node'}
      </button>
    </div>
  );
}
