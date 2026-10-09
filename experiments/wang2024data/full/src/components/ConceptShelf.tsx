import { useState } from 'react';
import type { Concept } from '../../shared/types';
import { Code } from './Code';

const TYPE_ICON: Record<string, string> = { quantitative: '#', nominal: 'Aa', ordinal: '1·2', temporal: '⏱' };

/**
 * Concept shelf: concepts* (draggable onto channels) and custom_concepts*.
 * Process 2 human specify: "New concept" names a custom concept with example values.
 * Process 3 human specify / process 4 human modify: open the derive panel.
 */
export function ConceptShelf({
  concepts,
  onAddCustom,
  onRemoveCustom,
  onDerive,
  onRefine,
  disabled,
}: {
  concepts: Concept[];
  onAddCustom: (c: Concept) => void;
  onRemoveCustom: (name: string) => void;
  onDerive: () => void;
  onRefine: (c: Concept) => void;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [examples, setExamples] = useState('');
  const [openCode, setOpenCode] = useState<string | null>(null);

  const exampleList = examples
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nameTaken = concepts.some((c) => c.name.toLowerCase() === name.trim().toLowerCase() && c.source !== 'custom');
  const canAdd = name.trim() !== '' && exampleList.length > 0 && !nameTaken;

  const add = () => {
    if (!canAdd) return;
    const numeric = exampleList.every((e) => !Number.isNaN(Number(e)));
    onAddCustom({ name: name.trim(), type: numeric ? 'quantitative' : 'nominal', source: 'custom', examples: exampleList });
    setName('');
    setExamples('');
    setAdding(false);
  };

  return (
    <section className="panel shelf">
      <h2>Concepts</h2>
      <div className="concepts">
        {concepts.map((c) => (
          <div
            key={c.name}
            className={`concept src-${c.source}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/concept', c.name)}
            title="Drag onto a chart channel"
          >
            <div className="concept-head">
              <span className="type">{TYPE_ICON[c.type]}</span>
              <span className="cname">{c.name}</span>
              <span className="badge">{c.source === 'original' ? '' : c.source}</span>
            </div>
            {c.source === 'custom' && (
              <div className="concept-body">
                <span className="muted small">examples: {c.examples?.join(', ')}</span>
                <button className="link" onClick={() => onRemoveCustom(c.name)}>
                  remove
                </button>
              </div>
            )}
            {c.source === 'derived' && c.derivation && (
              <div className="concept-body">
                <span className="muted small">
                  from {c.derivation.requests.at(-1)!.sources.join(', ')}: “{c.derivation.requests.at(-1)!.description}”
                </span>
                <div className="row">
                  <button className="link" onClick={() => setOpenCode(openCode === c.name ? null : c.name)}>
                    {openCode === c.name ? 'hide code' : 'code'}
                  </button>
                  <button className="link" onClick={() => onRefine(c)}>
                    refine…
                  </button>
                </div>
                {openCode === c.name && <Code code={c.derivation.code} maxHeight={200} />}
              </div>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <div className="form">
          <label>
            Concept name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. City" autoFocus />
          </label>
          {nameTaken && <div className="error small">A concept with this name already exists.</div>}
          <label>
            Example values (comma-separated)
            <input value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="e.g. Seattle, Atlanta" onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <div className="row">
            <button onClick={add} disabled={!canAdd}>
              Add concept
            </button>
            <button className="secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button disabled={disabled} onClick={() => setAdding(true)} title="Name a concept that is not in the table and give example values">
            + New concept by example
          </button>
          <button disabled={disabled} onClick={onDerive} title="Derive a concept from existing ones with a natural-language description">
            ✦ Derive concept
          </button>
        </div>
      )}
    </section>
  );
}
