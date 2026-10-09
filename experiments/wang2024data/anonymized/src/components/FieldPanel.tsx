import { useState } from 'react';
import type { Concept, FieldMeta } from '../types';

const TYPE_ICON: Record<string, string> = { quantitative: '#', nominal: 'Aa', temporal: '◷' };

function Chip({ name, kind, icon, onEdit }: { name: string; kind: string; icon: string; onEdit?: () => void }) {
  return (
    <div
      className={`chip chip-${kind}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={kind === 'concept' ? 'New concept — not in the data yet' : `${kind} field`}
    >
      <span className="chip-icon">{icon}</span>
      <span className="chip-name">{name}</span>
      {onEdit && (
        <button className="chip-edit" title="Edit derivation" onClick={onEdit}>
          ✎
        </button>
      )}
    </div>
  );
}

/** Shows r2 (field metadata) and r6 (new concepts); hosts [human specify] for r6 and r11. */
export function FieldPanel(props: {
  fields: FieldMeta[];
  concepts: Concept[];
  onAddConcept: (name: string) => void;
  onRemoveConcept: (name: string) => void;
  onDerive: () => void;
  onEditDerived: (f: FieldMeta) => void;
}) {
  const [name, setName] = useState('');
  const taken = new Set([...props.fields.map((f) => f.name), ...props.concepts.map((c) => c.name)]);
  const add = () => {
    const n = name.trim();
    if (!n || taken.has(n)) return;
    props.onAddConcept(n);
    setName('');
  };
  return (
    <div className="field-panel">
      <h3>Fields</h3>
      <div className="chips">
        {props.fields.map((f) => (
          <Chip
            key={f.name}
            name={f.name}
            kind={f.source}
            icon={TYPE_ICON[f.type]}
            onEdit={f.source === 'derived' ? () => props.onEditDerived(f) : undefined}
          />
        ))}
      </div>
      <h3>New concepts</h3>
      <p className="hint">Name a field your chart needs that is not in the data (e.g. "Quarter", "Sales"), drop it on a shelf, then formulate it by example.</p>
      <div className="chips">
        {props.concepts.map((c) => (
          <div key={c.name} className="chip-row">
            <Chip name={c.name} kind="concept" icon="✱" />
            <button className="x" title="Remove concept" onClick={() => props.onRemoveConcept(c.name)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="row">
        <input
          value={name}
          placeholder="concept name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!name.trim() || taken.has(name.trim())}>
          + Concept
        </button>
      </div>
      <h3>Derived fields</h3>
      <p className="hint">Describe a new field computed from existing ones; the model writes code for it.</p>
      <button className="primary wide" onClick={props.onDerive}>
        + Derive with AI…
      </button>
    </div>
  );
}
