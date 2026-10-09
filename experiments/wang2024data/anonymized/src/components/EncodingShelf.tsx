import { useState } from 'react';
import { CHANNELS, MARKS, type Channel, type Encoding } from '../types';

/** [human specify] r3: mark buttons + one drop shelf per channel (drag a chip, or pick from the menu). */
export function EncodingShelf({ encoding, options, onChange }: { encoding: Encoding; options: string[]; onChange: (e: Encoding) => void }) {
  const [over, setOver] = useState<Channel | null>(null);
  const set = (ch: Channel, field: string | undefined) => {
    const channels = { ...encoding.channels };
    if (field) channels[ch] = field;
    else delete channels[ch];
    onChange({ ...encoding, channels });
  };
  return (
    <div className="shelf">
      <div className="marks">
        {MARKS.map((m) => (
          <button key={m} className={m === encoding.mark ? 'on' : ''} onClick={() => onChange({ ...encoding, mark: m })}>
            {m}
          </button>
        ))}
      </div>
      <div className="channels">
        {CHANNELS.map((ch) => (
          <div
            key={ch}
            className={`channel ${over === ch ? 'over' : ''} ${encoding.channels[ch] ? 'filled' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(ch);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              set(ch, e.dataTransfer.getData('text/plain'));
            }}
          >
            <span className="ch-name">{ch}</span>
            <select value={encoding.channels[ch] ?? ''} onChange={(e) => set(ch, e.target.value || undefined)}>
              <option value="">— drop field —</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              {encoding.channels[ch] && !options.includes(encoding.channels[ch]!) && (
                <option value={encoding.channels[ch]}>{encoding.channels[ch]}</option>
              )}
            </select>
            <select
              className="agg"
              title="aggregate"
              value={encoding.aggregate[ch] ?? 'none'}
              onChange={(e) => onChange({ ...encoding, aggregate: { ...encoding.aggregate, [ch]: e.target.value as 'none' } })}
            >
              <option value="none">—</option>
              <option value="sum">sum</option>
              <option value="mean">mean</option>
              <option value="count">count</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
