import type { Channel, ChartSpec, Concept, Mark } from '../../shared/types';
import { CHANNELS, MARKS } from '../../shared/types';

const MARK_LABEL: Record<Mark, string> = { point: 'Scatter', bar: 'Bar', line: 'Line', area: 'Area', rect: 'Heatmap', tick: 'Strip' };

/** [human specify]: chart type + concept per visual channel -> chart_spec. */
export function ChartBuilder({
  spec,
  concepts,
  onChange,
}: {
  spec: ChartSpec;
  concepts: Concept[];
  onChange: (s: ChartSpec) => void;
}) {
  const setChannel = (ch: Channel, field: string | undefined) => {
    const encodings = { ...spec.encodings };
    if (field) encodings[ch] = field;
    else delete encodings[ch];
    onChange({ ...spec, encodings });
  };
  return (
    <div className="builder">
      <div className="marks" role="radiogroup" aria-label="Chart type">
        {MARKS.map((m) => (
          <button key={m} className={`mark ${spec.mark === m ? 'active' : ''}`} onClick={() => onChange({ ...spec, mark: m })} role="radio" aria-checked={spec.mark === m}>
            {MARK_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="channels">
        {CHANNELS.map((ch) => {
          const field = spec.encodings[ch];
          const concept = concepts.find((c) => c.name === field);
          return (
            <div
              key={ch}
              className={`channel ${field ? 'filled' : ''} ${concept ? `src-${concept.source}` : field ? 'missing' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const name = e.dataTransfer.getData('text/concept');
                if (name) setChannel(ch, name);
              }}
            >
              <span className="ch-name">{ch}</span>
              <select value={field ?? ''} onChange={(e) => setChannel(ch, e.target.value || undefined)}>
                <option value="">— drop or pick a concept —</option>
                {concepts.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.source === 'custom' ? ' (custom)' : ''}
                  </option>
                ))}
                {field && !concept && <option value={field}>{field} (not in this table)</option>}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
