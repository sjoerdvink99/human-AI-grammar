import { useEffect, useState } from 'react';
import { api, fileUrl } from '../api';
import type { ViewProps } from '../lib/viewProps';
import JobStatus from './JobStatus';

/** Stage 1: source image (processes 1, 2), layer plan (process 3), decomposition (processes 4, 5). */
export default function DecomposeView(props: ViewProps) {
  const { project } = props;
  const [showStart, setShowStart] = useState(false);
  const active = project.sourceVersions.find((v) => v.id === project.activeSourceId);
  if (!active || showStart) return <StartPanel {...props} onDone={() => setShowStart(false)} canCancel={!!active} />;
  const ws = project.workspaces[active.id];
  return (
    <div className="decompose">
      <section className="panel source-col">
        <h3>Source image</h3>
        <SourceVersions {...props} onNew={() => setShowStart(true)} />
        <RefineBox {...props} />
      </section>
      <section className="main-col">
        <div className="source-view">
          <img src={fileUrl(project, active.file)} alt="source" />
        </div>
        {ws && ws.decomposeStatus !== 'idle' && <DecomposeProgress {...props} />}
      </section>
      <section className="panel plan-col">
        <PlanPanel {...props} />
      </section>
    </div>
  );
}

// ---------------- process 1: Generate source image (or upload) ----------------
function StartPanel({ project, jobs, reload, onDone, canCancel }: ViewProps & { onDone: () => void; canCancel: boolean }) {
  const [prompt, setPrompt] = useState(project.prompt ?? '');
  const gen = jobs.jobs.generate;
  // start a job whose POST creates a new source version, then leave the start panel right away
  const startThen = (url: string, body: unknown) =>
    jobs.run('plan', async () => {
      const r = await api('POST', url, body);
      await reload();
      onDone();
      return r;
    });
  const upload = (f: File) => startThen(`/api/projects/${project.id}/upload`, f);
  return (
    <div className="start">
      <h2>Start from an image</h2>
      <div className="start-grid">
        <div className="panel">
          <h3>Upload a photo or picture</h3>
          <label className="dropzone">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            Click to choose an image (PNG, JPG, WebP, SVG)
          </label>
        </div>
        <div className="panel">
          <h3>…or describe one</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) jobs.run('generate', () => api('POST', `/api/projects/${project.id}/generate`, { prompt }));
            }}
          >
            <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. a fox under a pine tree in front of snowy mountains at dusk" />
            <button className="primary" disabled={jobs.busy('generate') || !prompt.trim()}>
              Generate 3 candidates
            </button>
          </form>
          <JobStatus job={gen} label="Generation" />
          {project.imageCandidates.length > 0 && !jobs.busy('generate') && (
            <>
              <p className="muted">Choose one to take into the design workflow:</p>
              <div className="candidates">
                {project.imageCandidates.map((f, i) => (
                  <button
                    key={f}
                    className="candidate"
                    onClick={() => startThen(`/api/projects/${project.id}/candidates/select`, { index: i })}
                  >
                    <img src={fileUrl(project, f)} />
                    <span>Use this one</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {gen?.status === 'done' && <button onClick={() => jobs.run('generate', () => api('POST', `/api/projects/${project.id}/generate`, { prompt }))}>Regenerate</button>}
        </div>
      </div>
      {canCancel && (
        <button className="link" onClick={onDone}>
          Cancel
        </button>
      )}
      <ReloadOnMount reload={reload} />
    </div>
  );
}
function ReloadOnMount({ reload }: { reload: () => void }) {
  useEffect(() => {
    reload();
  }, [reload]);
  return null;
}

// ---------------- process 2: Refine source image ----------------
function SourceVersions({ project, setProject, onNew }: ViewProps & { onNew: () => void }) {
  return (
    <div className="versions">
      {project.sourceVersions.map((v, i) => (
        <button
          key={v.id}
          className={'version' + (v.id === project.activeSourceId ? ' active' : '')}
          title={v.instruction ?? v.origin}
          onClick={async () => setProject(await api('POST', `/api/projects/${project.id}/active`, { sourceId: v.id }))}
        >
          <img src={fileUrl(project, v.file)} />
          <span>
            v{i + 1} · {v.origin}
          </span>
        </button>
      ))}
      <button className="version new" onClick={onNew}>
        + New source
      </button>
    </div>
  );
}

function RefineBox({ project, jobs }: ViewProps) {
  const [text, setText] = useState('');
  return (
    <form
      className="refine"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        jobs.run('refine', () => api('POST', `/api/projects/${project.id}/refine`, { sourceId: project.activeSourceId, instruction: text }));
        setText('');
      }}
    >
      <label>Change the image</label>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. make it night with a full moon" />
      <button disabled={jobs.busy('refine') || !text.trim()}>Regenerate as new version</button>
      <JobStatus job={jobs.jobs.refine} label="Refinement" />
      <p className="muted small">Each version is kept and can be analyzed on its own.</p>
    </form>
  );
}

// ---------------- process 3: Propose and revise depth layers ----------------
function PlanPanel({ project, jobs, setProject }: ViewProps) {
  const ws = project.workspaces[project.activeSourceId!];
  const [text, setText] = useState('');
  const plan = ws?.layerPlan;
  const planJob = jobs.jobs.plan ?? jobs.jobs.revise;
  const busy = jobs.busy('plan') || jobs.busy('revise') || jobs.busy('refine');
  const decomposing = ws?.decomposeStatus === 'running' || jobs.busy('decompose');
  return (
    <>
      <h3>Depth layers</h3>
      {!plan && !busy && (
        <button className="primary" onClick={() => jobs.run('plan', () => api('POST', `/api/projects/${project.id}/plan/propose`))}>
          Propose layers
        </button>
      )}
      <JobStatus job={planJob} label="Layer proposal" onRetry={() => jobs.run('plan', () => api('POST', `/api/projects/${project.id}/plan/propose`))} />
      {plan && (
        <ol className="plan">
          {plan.layers.map((l) => (
            <li key={l.id}>
              <div className="layer-name">
                <span className="depth-badge">{l.depth === 0 ? 'front' : l.depth === plan.layers.length - 1 ? 'back' : `depth ${l.depth}`}</span> {l.name}
              </div>
              <ul>
                {l.elements.map((e) => (
                  <li key={e.id} title={e.description}>
                    {e.name}
                    <small className="muted"> — {e.description}</small>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {ws && ws.planChat.length > 0 && (
        <div className="chat">
          {ws.planChat.map((m, i) => (
            <div key={i} className={'msg ' + m.role}>
              {m.text}
            </div>
          ))}
        </div>
      )}
      {plan && (
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            jobs.run('revise', () => api('POST', `/api/projects/${project.id}/plan/change`, { text }));
            setText('');
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. put the bird on its own layer; you missed the moon" disabled={busy} />
          <button disabled={busy || !text.trim()}>Send</button>
        </form>
      )}
      {ws && ws.layerPlanHistory.length > 0 && (
        <div className="history small">
          Earlier proposals:{' '}
          {ws.layerPlanHistory.map((_, i) => (
            <button key={i} className="chip" onClick={async () => setProject(await api('POST', `/api/projects/${project.id}/plan/revert`, { index: i }))}>
              v{i + 1}
            </button>
          ))}
        </div>
      )}
      {plan && (
        <button
          className="primary wide"
          disabled={busy || decomposing}
          onClick={() => {
            if (ws.canvas && !confirm('Re-running decomposition replaces the current composition. Continue?')) return;
            jobs.run('decompose', () => api('POST', `/api/projects/${project.id}/confirm`));
          }}
        >
          {ws.canvas ? 'Confirm & decompose again' : 'Confirm layers & decompose'}
        </button>
      )}
    </>
  );
}

// ---------------- process 4/5 progress ----------------
function DecomposeProgress({ project, jobs }: ViewProps) {
  const ws = project.workspaces[project.activeSourceId!];
  const els = Object.values(ws.elements);
  const layers = ws.confirmedLayers?.layers ?? [];
  return (
    <div className="panel progress">
      <h3>
        Decomposition {ws.decomposeStatus === 'running' && <span className="spinner" />}
        {ws.decomposeStatus === 'error' && <span className="error"> failed</span>}
      </h3>
      <JobStatus job={jobs.jobs.decompose} label="Decomposition" />
      {ws.style && (
        <p className="small">
          <b>Style:</b> {ws.style}
        </p>
      )}
      <div className="filmstrip">
        {ws.workImages.map((f, i) => (
          <figure key={f}>
            <img src={fileUrl(project, f)} />
            <figcaption>{i === 0 ? 'original' : `after layer ${i}`}</figcaption>
          </figure>
        ))}
      </div>
      {layers.map((l) => {
        const mine = els.filter((e) => e.layerId === l.id);
        if (!mine.length) return null;
        return (
          <div key={l.id} className="seg-row">
            <b>{l.name}</b>
            <div className="segs">
              {mine.map((e) => (
                <figure key={e.id} className="seg" title={e.quality ? `confidence ${e.quality.confidence.toFixed(2)}, box IoU ${e.quality.bboxIoU.toFixed(2)}` : ''}>
                  <img src={fileUrl(project, e.texture)} />
                  <figcaption>
                    {e.name}
                    {e.quality && e.quality.stage !== 'initial' && <span className="badge">{e.quality.stage}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        );
      })}
      <details>
        <summary>Step log ({ws.decomposeLog.length})</summary>
        <ol className="log">
          {ws.decomposeLog.map((l, i) => (
            <li key={i}>
              {l.step}
              {l.detail && <small className="muted"> — {l.detail}</small>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
