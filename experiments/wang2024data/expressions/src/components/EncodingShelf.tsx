import { CHANNELS, MARKS, type Aggregate, type Channel, type ChartSpec, type Concept, type Mark } from '../shared/types';

const AGGS: Aggregate[] = ['none', 'sum', 'mean', 'median', 'count', 'min', 'max'];

interface Props {
  spec: ChartSpec;
  concepts: Concept[];
  onChange: (s: ChartSpec) => void;
  onFormulate: () => void;
  busy?: boolean;
}

/** [human specify] chart_spec: mark + channel→concept bindings. */
export function EncodingShelf({ spec, concepts, onChange, onFormulate, busy }: Props) {
  const setChannel = (ch: Channel, field: string | null) => {
    const encodings = { ...spec.encodings };
    if (field) encodings[ch] = { field, aggregate: encodings[ch]?.aggregate };
    else delete encodings[ch];
    onChange({ ...spec, encodings });
  };
  const hasCustom = Object.values(spec.encodings).some((e) => concepts.find((c) => c.name === e?.field)?.source === 'custom');
  const empty = Object.keys(spec.encodings).length === 0;

  return (
    <section className="panel shelf">
      <div className="shelf-head">
        <label>
          Mark&nbsp;
          <select value={spec.mark} onChange={(e) => onChange({ ...spec, mark: e.target.value as Mark })}>
            {MARKS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <button className="link" onClick={() => onChange({ ...spec, encodings: {} })}>clear</button>
        <span className="spacer" />
        <button className="primary" disabled={empty || busy} onClick={onFormulate}>
          {hasCustom ? 'Formulate data & chart' : 'Make chart'}
        </button>
      </div>
      <div className="channels">
        {CHANNELS.map((ch) => {
          const enc = spec.encodings[ch];
          const concept = concepts.find((c) => c.name === enc?.field);
          return (
            <div
              key={ch}
              className={`channel ${enc ? 'filled' : ''} ${concept?.source ?? ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const name = e.dataTransfer.getData('text/concept');
                if (name) setChannel(ch, name);
              }}
            >
              <span className="channel-name">{ch}</span>
              <select value={enc?.field ?? ''} onChange={(e) => setChannel(ch, e.target.value || null)}>
                <option value="">—</option>
                {concepts.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}{c.source === 'custom' ? ' (new)' : ''}</option>
                ))}
              </select>
              {enc && (ch === 'x' || ch === 'y' || ch === 'size' || ch === 'color') && (
                <select
                  className="agg"
                  title="aggregate"
                  value={enc.aggregate ?? 'none'}
                  onChange={(e) => onChange({ ...spec, encodings: { ...spec.encodings, [ch]: { ...enc, aggregate: e.target.value as Aggregate } } })}
                >
                  {AGGS.map((a) => <option key={a}>{a}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
      {hasCustom && (
        <p className="muted small">This chart uses concepts that are not in the table yet. You will show an example of the data it needs.</p>
      )}
    </section>
  );
}
