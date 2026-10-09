import { useEffect, useState } from 'react';
import { api, useJobs, useProject } from './api';
import DecomposeView from './components/DecomposeView';
import CreateView from './components/CreateView';
import PrepareView from './components/PrepareView';

type Stage = 'decompose' | 'create' | 'prepare';

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(() => new URLSearchParams(location.search).get('p'));
  useEffect(() => {
    const url = projectId ? `?p=${projectId}` : location.pathname;
    history.replaceState(null, '', url);
  }, [projectId]);
  return projectId ? <ProjectView id={projectId} onExit={() => setProjectId(null)} /> : <ProjectList onOpen={setProjectId} />;
}

function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string; createdAt: number; thumb?: string }[]>([]);
  const [name, setName] = useState('');
  useEffect(() => {
    api('GET', '/api/projects').then(setList);
  }, []);
  return (
    <div className="home">
      <h1>System X</h1>
      <p className="muted">Turn a picture into a layered, laser-cut artwork: Decompose → Create → Prepare.</p>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const p = await api('POST', '/api/projects', { name: name || 'Untitled design' });
          onOpen(p.id);
        }}
      >
        <input placeholder="Design name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary">New design</button>
      </form>
      <div className="project-grid">
        {list.map((p) => (
          <button key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
            {p.thumb ? <img src={`/data/${p.id}/${p.thumb}`} /> : <div className="thumb-empty" />}
            <span>{p.name}</span>
            <small className="muted">{new Date(p.createdAt).toLocaleString()}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectView({ id, onExit }: { id: string; onExit: () => void }) {
  const { project, setProject, reload } = useProject(id);
  const jobs = useJobs(reload);
  const [stage, setStage] = useState<Stage>('decompose');
  const ws = project?.activeSourceId ? project.workspaces[project.activeSourceId] : undefined;
  const hasCanvas = !!ws?.canvas;
  const [autoSwitched, setAutoSwitched] = useState(false);
  useEffect(() => {
    if (hasCanvas && !autoSwitched && ws?.decomposeStatus === 'done') {
      setAutoSwitched(true);
      if (jobs.jobs.decompose?.status === 'done') setStage('create');
    }
  }, [hasCanvas, ws?.decomposeStatus, jobs.jobs.decompose?.status, autoSwitched]);

  if (!project) return <div className="loading">Loading…</div>;
  return (
    <div className="app">
      <header className="topbar">
        <button className="link" onClick={onExit}>
          ← Designs
        </button>
        <strong>{project.name}</strong>
        <nav className="stages">
          {(['decompose', 'create', 'prepare'] as Stage[]).map((s, i) => (
            <button
              key={s}
              className={stage === s ? 'active' : ''}
              disabled={s !== 'decompose' && !hasCanvas}
              onClick={() => setStage(s)}
              title={s !== 'decompose' && !hasCanvas ? 'Decompose the image first' : ''}
            >
              {i + 1}. {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <RunningJobs jobs={jobs.jobs} />
      </header>
      <main className="stage">
        {stage === 'decompose' && <DecomposeView project={project} setProject={setProject} jobs={jobs} reload={reload} />}
        {stage === 'create' && ws && <CreateView project={project} ws={ws} setProject={setProject} jobs={jobs} reload={reload} />}
        {stage === 'prepare' && ws && <PrepareView project={project} ws={ws} setProject={setProject} jobs={jobs} reload={reload} />}
      </main>
    </div>
  );
}

function RunningJobs({ jobs }: { jobs: Record<string, import('../../shared/types').Job | undefined> }) {
  const running = Object.values(jobs).filter((j) => j?.status === 'running');
  if (!running.length) return null;
  return (
    <span className="running">
      <span className="spinner" /> {running.map((j) => j!.log.at(-1) || j!.kind).join(' · ')}
    </span>
  );
}
