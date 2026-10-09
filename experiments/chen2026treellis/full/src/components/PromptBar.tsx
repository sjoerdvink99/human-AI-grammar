// prompt (process 1) and followup_prompt (process 6): global text prompts.
import { useState } from 'react';

interface Props {
  hasScene: boolean;
  busy: boolean;
  running: boolean;
  onGenerate: (prompt: string, useCurrentScene: boolean) => Promise<boolean>;
  onNew: () => void;
}

export function PromptBar({ hasScene, busy, running, onGenerate, onNew }: Props) {
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim() || busy) return;
    if (await onGenerate(text, hasScene)) setText('');
  };
  return (
    <div className="prompt-bar">
      <input
        type="text"
        value={text}
        disabled={busy}
        placeholder={hasScene ? 'Describe the whole object again — the current scene is used as context…' : 'Describe a 3D object, e.g. “a wooden rocking chair with armrests”'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button className="primary" disabled={busy || !text.trim()} onClick={submit}>
        {running ? 'Generating…' : hasScene ? 'Regenerate' : 'Generate'}
      </button>
      {hasScene && (
        <button disabled={busy} onClick={onNew} title="Discard the scene and start a new object from a prompt">
          New
        </button>
      )}
    </div>
  );
}
