import { useState } from 'react';
import { UrbanProbe } from './urban/UrbanProbe';
import { IkebanaProbe } from './ikebana/IkebanaProbe';
import { PosterProbe } from './poster/PosterProbe';

const PROBES = [
  { key: 'urban', label: 'Urban neighborhood', hint: 'elastic bands · clay · magnets' },
  { key: 'ikebana', label: 'Ikebana', hint: 'magnets' },
  { key: 'poster', label: 'Graphic poster', hint: 'sand · voice' },
] as const;

export function App() {
  const [probe, setProbe] = useState<(typeof PROBES)[number]['key']>('urban');
  return (
    <div className="app">
      <header>
        <div className="brand">System X <small>material gestures → AI-generated visual design</small></div>
        <nav>
          {PROBES.map((p) => (
            <button key={p.key} className={probe === p.key ? 'tab active' : 'tab'} onClick={() => setProbe(p.key)}>
              {p.label}<small>{p.hint}</small>
            </button>
          ))}
        </nav>
      </header>
      {/* Probes stay mounted so switching tabs keeps their state. */}
      <main style={{ display: probe === 'urban' ? 'flex' : 'none' }}><UrbanProbe /></main>
      <main style={{ display: probe === 'ikebana' ? 'flex' : 'none' }}><IkebanaProbe /></main>
      <main style={{ display: probe === 'poster' ? 'flex' : 'none' }}><PosterProbe /></main>
    </div>
  );
}
