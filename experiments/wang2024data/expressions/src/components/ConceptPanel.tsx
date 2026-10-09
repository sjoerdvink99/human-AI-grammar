import { useState } from 'react';
import type { Concept, ConceptType } from '../shared/types';

const TYPES: ConceptType[] = ['quantitative', 'nominal', 'ordinal', 'temporal'];
const TYPE_ICON: Record<ConceptType, string> = { quantitative: '#', nominal: 'Aa', ordinal: '1‑2', temporal: '◷' };

interface Props {
  concepts: Concept[];
  onAddCustom: (c: Concept) => void;
  onRemoveCustom: (name: string) => void;
  onDerive: () => void;
  onEditDerivation: (c: Concept) => void;
  onPick: (name: string) => void;
}

/** Shows concepts*; [human specify] custom_concepts* via the "New concept" form. */
export function ConceptPanel({ concepts, onAddCustom, onRemoveCustom, onDerive, onEditDerivation, onPick }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ConceptType>('nominal');
  const taken = concepts.some((c) => c.name === name.trim());

  const groups: [string, Concept[]][] = [
    ['From the table', concepts.filter((c) => c.source === 'table')],
    ['Derived', concepts.filter((c) => c.source === 'derived')],
    ['Custom (no data yet)', concepts.filter((c) => c.source === 'custom')],
  ];

  return (
    <aside className="panel concepts">
      <h2>Concepts</h2>
      <p className="muted small">Drag a concept onto a channel, or click to place it on the first free one.</p>
      {groups.map(([title, cs]) =>
        cs.length ? (
          <div key={title} className="concept-group">
            <h3>{title}</h3>
            {cs.map((c) => (
              <div
                key={c.name}
                className={`concept-chip ${c.source}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/concept', c.name)}
                onClick={() => onPick(c.name)}
                title={c.derivation ? `Derived: ${c.derivation.request.description}` : c.type}
              >
                <span className="type-icon">{TYPE_ICON[c.type]}</span>
                <span className="concept-name">{c.name}</span>
                {c.source === 'derived' && (
                  <button className="link" onClick={(e) => { e.stopPropagation(); onEditDerivation(c); }}>edit</button>
                )}
                {c.source === 'custom' && (
                  <button className="link" aria-label={`remove ${c.name}`} onClick={(e) => { e.stopPropagation(); onRemoveCustom(c.name); }}>×</button>
                )}
              </div>
            ))}
          </div>
        ) : null,
      )}

      <form
        className="new-concept"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || taken) return;
          onAddCustom({ name: name.trim(), type, source: 'custom' });
          setName('');
        }}
      >
        <h3>New concept</h3>
        <input placeholder="name, e.g. City" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as ConceptType)}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button type="submit" disabled={!name.trim() || taken}>Add</button>
        {taken && <div className="error small">A concept with that name exists.</div>}
      </form>
      <button className="primary wide" onClick={onDerive}>Derive a concept…</button>
    </aside>
  );
}
