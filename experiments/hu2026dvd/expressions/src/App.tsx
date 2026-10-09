import { useState } from 'react';
import { api } from './api';
import { useProject } from './state';
import { ChartView } from './views/ChartView';
import { ComposeView } from './views/ComposeView';
import { StoryView } from './views/StoryView';
import { VersionsView } from './views/VersionsView';

const TABS = [
  { id: 'story', label: 'Story', hint: 'brief → scripts → video' },
  { id: 'chart', label: 'Chart', hint: 'data → animated chart' },
  { id: 'compose', label: 'Compose', hint: 'put the chart into the video' },
  { id: 'versions', label: 'Versions', hint: 'review renders' },
] as const;

export function App() {
  const store = useProject();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('story');
  if (store.error) return <div className="fatal">Could not load project: {store.error}</div>;
  if (!store.project) return <div className="fatal">Loading…</div>;
  return (
    <div className="app">
      <header>
        <div className="brand">System X <span>data video studio</span></div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} title={t.hint}>
              {t.label}
              {t.id === 'versions' && store.project!.versions.length > 0 && <span className="badge">{store.project!.versions.length}</span>}
            </button>
          ))}
        </nav>
        <button className="ghost small" onClick={async () => { if (confirm('Reset the project to the example? All versions are removed from the list.')) store.replace(await api.reset()); }}>Reset example</button>
      </header>
      <main>
        {tab === 'story' && <StoryView store={store} />}
        {tab === 'chart' && <ChartView store={store} />}
        {tab === 'compose' && <ComposeView store={store} />}
        {tab === 'versions' && <VersionsView store={store} />}
      </main>
    </div>
  );
}
