import { useState } from 'react';
import type { Concept, DerivationRequest } from '../shared/types';

interface Props {
  concepts: Concept[];
  initial?: DerivationRequest;
  editing: boolean;
  busy: boolean;
  onSubmit: (r: DerivationRequest) => void;
  onCancel: () => void;
}

/** [human specify] derivation_request_1, or [human modify] derivation_request_1 -> _2 when editing. */
export function DerivationForm({ concepts, initial, editing, busy, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sources, setSources] = useState<string[]>(initial?.sourceConcepts ?? []);
  const [description, setDescription] = useState(initial?.description ?? '');
  const usable = concepts.filter((c) => c.source !== 'custom' && c.name !== initial?.name);
  const clash = !editing && concepts.some((c) => c.name === name.trim() && c.source !== 'custom');
  const ok = name.trim() && description.trim() && !clash;

  return (
    <section className="panel derive">
      <h2>{editing ? `Edit derivation of “${initial?.name}”` : 'Derive a new concept'}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSubmit({ name: name.trim(), sourceConcepts: sources, description: description.trim() });
        }}
      >
        <label>
          New concept name
          <input value={name} disabled={editing} onChange={(e) => setName(e.target.value)} placeholder="e.g. Difference" />
        </label>
        {clash && <div className="error small">That name is already a column.</div>}
        <div>
          Derived from
          <div className="source-chips">
            {usable.map((c) => (
              <label key={c.name} className={`chip ${sources.includes(c.name) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={sources.includes(c.name)}
                  onChange={(e) => setSources(e.target.checked ? [...sources, c.name] : sources.filter((s) => s !== c.name))}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <label>
          Description
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Seattle temperature minus Atlanta temperature" />
        </label>
        <div className="row-actions">
          <span className="spacer" />
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit" disabled={!ok || busy}>{busy ? 'Generating…' : 'Generate code'}</button>
        </div>
      </form>
    </section>
  );
}
