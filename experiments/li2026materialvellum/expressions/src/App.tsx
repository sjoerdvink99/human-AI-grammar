import { useState } from 'react';
import UrbanView from './urban/UrbanView';
import IkebanaView from './ikebana/IkebanaView';
import PosterView from './poster/PosterView';

const MODES = [
  { key: 'urban', label: 'City', blurb: 'zoning bands → city model → render → function magnets' },
  { key: 'ikebana', label: 'Ikebana', blurb: 'placed stems & flowers → scribble → image' },
  { key: 'poster', label: 'Poster', blurb: 'sand heaps + spoken roles → poster' },
] as const;

export default function App() {
  const [mode, setMode] = useState<(typeof MODES)[number]['key']>('urban');
  return (
    <div className="app">
      <header>
        <h1>System X <span>tangible generative studio</span></h1>
        <nav>
          {MODES.map((m) => (
            <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)} title={m.blurb}>
              {m.label}
            </button>
          ))}
        </nav>
      </header>
      {/* all three processes stay mounted so switching modes keeps their state */}
      <main>
        <div hidden={mode !== 'urban'}><UrbanView /></div>
        <div hidden={mode !== 'ikebana'}><IkebanaView /></div>
        <div hidden={mode !== 'poster'}><PosterView /></div>
      </main>
    </div>
  );
}
