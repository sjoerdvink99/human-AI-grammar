import { useState } from 'react';
import type { CodeCandidate } from '../shared/types';
import { Code } from './Code';
import { DataTable } from './DataTable';

interface Props {
  candidates: CodeCandidate[];
  prompts: string[];
  busy: boolean;
  onSelect: (c: CodeCandidate) => void;
  onRegenerate: () => void;
}

/** valid_codes* + preview_tables* -> [human select] selected_code. */
export function DerivationCandidates({ candidates, prompts, busy, onSelect, onRegenerate }: Props) {
  const [showPrompts, setShowPrompts] = useState(false);
  const valid = candidates.filter((c) => c.valid);
  const invalid = candidates.filter((c) => !c.valid);
  return (
    <section className="panel derive-candidates">
      <div className="row-actions">
        <h2>{valid.length} working candidate{valid.length === 1 ? '' : 's'}</h2>
        <span className="spacer" />
        <button className="link" onClick={() => setShowPrompts(!showPrompts)}>{showPrompts ? 'hide' : 'show'} prompts</button>
        <button disabled={busy} onClick={onRegenerate}>{busy ? 'Generating…' : 'Regenerate'}</button>
      </div>
      {showPrompts && prompts.map((p, i) => <pre key={i} className="prompt">{p}</pre>)}
      {valid.length === 0 && <p className="error">No candidate passed the checks. Rephrase the description or regenerate.</p>}
      <div className="candidates">
        {valid.map((c, i) => (
          <div key={i} className="candidate">
            <Code code={c.code} />
            {c.preview && <DataTable table={c.preview} highlight={[c.preview.columns[c.preview.columns.length - 1]]} />}
            <div className="row-actions">
              <span className="muted small">from prompt {c.prompt + 1}</span>
              <span className="spacer" />
              <button className="primary" onClick={() => onSelect(c)}>Use this</button>
            </div>
          </div>
        ))}
      </div>
      {invalid.length > 0 && (
        <details>
          <summary className="muted small">{invalid.length} candidate(s) rejected by checks</summary>
          {invalid.map((c, i) => (
            <div key={i} className="rejected">
              <div className="error small">prompt {c.prompt + 1}: {c.error}</div>
              {c.code && <Code code={c.code} />}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
