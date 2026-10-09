import { useEffect, useState } from 'react';
import { useProject } from './store';
import BuildPanel from './author/BuildPanel';
import PersonaLab from './author/PersonaLab';
import EventsPanel from './author/EventsPanel';
import Play from './play/Play';
import { api } from './api';

type Tab = 'build' | 'persona' | 'events';

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

export default function App() {
  const hash = useHash();
  const play = hash.match(/^#\/play\/([\w-]+)/);
  if (play) return <Play id={play[1]} />;
  return <Author />;
}

function Author() {
  const { project, update, reset } = useProject();
  const [tab, setTab] = useState<Tab>('build');
  const [library, setLibrary] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => { api.listVignettes().then(setLibrary).catch(() => {}); }, [project.vignetteId]);
  const step2Ready = project.characters.length > 0;
  const step3Ready = !!project.environment && project.characters.length > 0;
  return (
    <div className="app">
      <header className="topbar">
        <h1>Story Vignettes</h1>
        <nav className="tabs">
          <button className={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')}>1 · Environment & characters</button>
          <button className={tab === 'persona' ? 'on' : ''} disabled={!step2Ready} onClick={() => setTab('persona')}>2 · Persona lab</button>
          <button className={tab === 'events' ? 'on' : ''} disabled={!step3Ready} onClick={() => setTab('events')}>3 · Key events</button>
        </nav>
        <div className="spacer" />
        {library.length > 0 && (
          <select value="" onChange={(e) => { if (e.target.value) location.hash = `#/play/${e.target.value}`; }}>
            <option value="">▶ Play a saved vignette…</option>
            {library.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
        )}
        <button className="ghost" onClick={() => { if (confirm('Start a new story? The current project will be cleared.')) { reset(); setTab('build'); } }}>New story</button>
      </header>
      <main>
        {tab === 'build' && <BuildPanel project={project} update={update} />}
        {tab === 'persona' && <PersonaLab project={project} update={update} />}
        {tab === 'events' && <EventsPanel project={project} update={update} />}
      </main>
    </div>
  );
}
