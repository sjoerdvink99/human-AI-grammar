import { useCallback, useEffect, useState } from 'react';
import { api, useJobs, type ClientState } from './api.ts';
import { ImageView } from './views/ImageView.tsx';
import { PlanView } from './views/PlanView.tsx';
import { BuildView } from './views/BuildView.tsx';
import { CanvasView } from './views/CanvasView.tsx';
import { FabricationView } from './views/FabricationView.tsx';
import { ExportView } from './views/ExportView.tsx';
import { JobTrace } from './views/JobTrace.tsx';

const TABS = [
  { id: 'image', label: '1 · Image', hint: 'P1–P2' },
  { id: 'plan', label: '2 · Layer plan', hint: 'P3–P4' },
  { id: 'build', label: '3 · Decomposition', hint: 'P4–P5' },
  { id: 'canvas', label: '4 · Canvas', hint: 'P6–P9' },
  { id: 'fab', label: '5 · Fabricate', hint: 'P10' },
  { id: 'export', label: '6 · Export', hint: 'P11' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [state, setState] = useState<ClientState | null>(null);
  const [tab, setTab] = useState<TabId>('image');
  const refresh = useCallback(async () => setState(await api<ClientState>('/state')), []);
  const jobs = useJobs(refresh);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!state) return <div className="loading">Loading…</div>;
  const enabled: Record<TabId, boolean> = {
    image: true,
    plan: state.sourceImages.length > 0,
    build: state.rounds.length > 0 || jobs.job?.kind === 'p4',
    canvas: !!state.canvas,
    fab: !!state.canvas,
    export: !!state.canvas,
  };
  const props = { state, jobs, refresh, goto: setTab };
  return (
    <div className="app">
      <header>
        <div className="brand">
          <strong>LayerCraft</strong> <span className="muted">— System X</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} disabled={!enabled[t.id]} onClick={() => setTab(t.id)} title={t.hint}>
              {t.label}
            </button>
          ))}
        </nav>
        <button
          className="ghost"
          onClick={async () => {
            if (confirm('Start a new project? This clears everything.')) {
              await api('/reset', {});
              await refresh();
              setTab('image');
            }
          }}
        >
          New project
        </button>
      </header>
      <main>
        <section className="view">
          {tab === 'image' && <ImageView {...props} />}
          {tab === 'plan' && <PlanView {...props} />}
          {tab === 'build' && <BuildView {...props} />}
          {tab === 'canvas' && <CanvasView {...props} />}
          {tab === 'fab' && <FabricationView {...props} />}
          {tab === 'export' && <ExportView {...props} />}
        </section>
        <aside className="trace">
          <JobTrace jobs={jobs} />
        </aside>
      </main>
    </div>
  );
}

export interface ViewProps {
  state: ClientState;
  jobs: ReturnType<typeof useJobs>;
  refresh: () => Promise<void>;
  goto: (t: TabId) => void;
}
