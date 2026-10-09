import { useEffect, useState } from 'react';
import { MATERIAL_PRESETS, type MaterialSettings } from '../../../shared/types';
import { api, fileUrl } from '../api';
import type { WsProps } from '../lib/viewProps';
import LayerCanvas from './LayerCanvas';
import JobStatus from './JobStatus';

interface LayerFiles {
  layerId: string;
  name: string;
  depth: number;
  svgFile: string;
  pngFile: string;
}

/** Stage 3: check & resolve fabrication constraints (process 10), export (process 11). */
export default function PrepareView(props: WsProps) {
  const { project, ws, jobs } = props;
  const [layerId, setLayerId] = useState<string>('all');
  const [hl, setHl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const canvas = ws.canvas!;
  const mm = ws.material.sheetWidthMm / canvas.width;
  const check = () => jobs.run('check', () => api('POST', `/api/projects/${project.id}/prepare/check`));

  // entering Prepare mode triggers the checks
  useEffect(() => {
    check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shownCanvas = layerId === 'all' ? canvas : { ...canvas, layers: canvas.layers.filter((l) => l.id === layerId) };
  const issues = ws.prepare.issues.filter((i) => layerId === 'all' || i.layerId === layerId);
  const checking = jobs.busy('check') || jobs.busy('resolve');

  return (
    <div className="prepare">
      <section className="panel layers-col">
        <MaterialForm {...props} onSaved={check} />
        <h3>Issues {checking && <span className="spinner" />}</h3>
        {!checking && !ws.prepare.issues.length && ws.prepare.checkedAt && <p className="ok">No fabrication problems found.</p>}
        <ul className="issues">
          {ws.prepare.issues.map((i) => (
            <li key={i.id} className={i.type + (hl === i.id ? ' hl' : '')} onMouseEnter={() => setHl(i.id)} onMouseLeave={() => setHl(null)} onClick={() => setLayerId(i.layerId)}>
              <b>{i.id}</b> <span className="badge">{i.type === 'floating' ? 'floating' : 'too thin'}</span> {i.detail}
            </li>
          ))}
        </ul>
      </section>
      <section className="canvas-col">
        <div className="tabs small">
          <button className={layerId === 'all' ? 'active' : ''} onClick={() => setLayerId('all')}>
            All layers
          </button>
          {[...canvas.layers]
            .sort((a, b) => a.depth - b.depth)
            .map((l) => (
              <button key={l.id} className={layerId === l.id ? 'active' : ''} onClick={() => setLayerId(l.id)}>
                {l.name} {ws.prepare.issues.some((i) => i.layerId === l.id) && <span className="dot" />}
              </button>
            ))}
        </div>
        <LayerCanvas project={project} canvas={shownCanvas} elements={ws.elements} mmPerPx={mm} readOnly issues={issues} highlightIssue={hl} />
        {exporting && <ExportPanel {...props} onClose={() => setExporting(false)} />}
      </section>
      <section className="panel right-col">
        <AgentPanel {...props} onExport={() => setExporting(true)} onRecheck={check} />
      </section>
    </div>
  );
}

function MaterialForm({ project, ws, setProject, onSaved }: WsProps & { onSaved: () => void }) {
  const [m, setM] = useState<MaterialSettings>(ws.material);
  useEffect(() => setM(ws.material), [ws.material]);
  const dirty = JSON.stringify(m) !== JSON.stringify(ws.material);
  const field = (k: keyof MaterialSettings, label: string, step = 0.1) => (
    <label>
      {label}
      <input type="number" step={step} value={m[k] as number} onChange={(e) => setM({ ...m, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <form
      className="material"
      onSubmit={async (e) => {
        e.preventDefault();
        setProject(await api('PUT', `/api/projects/${project.id}/material`, m));
        onSaved();
      }}
    >
      <h3>Material</h3>
      <label>
        Material
        <select value={m.material} onChange={(e) => setM({ ...m, ...(MATERIAL_PRESETS[e.target.value] ?? { material: e.target.value }) })}>
          {Object.keys(MATERIAL_PRESETS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <div className="grid2">
        {field('thicknessMm', 'Thickness (mm)')}
        {field('minFeatureMm', 'Min. feature (mm)')}
        {field('sheetWidthMm', 'Sheet width (mm)', 1)}
        {field('layerGapMm', 'Layer gap (mm)', 0.5)}
      </div>
      <button disabled={!dirty}>Apply & re-check</button>
    </form>
  );
}

function AgentPanel({ project, ws, jobs, onExport, onRecheck }: WsProps & { onExport: () => void; onRecheck: () => void }) {
  const [text, setText] = useState('');
  const report = ws.prepare.report;
  const busy = jobs.busy('check') || jobs.busy('resolve');
  const resolve = (body: { optionId?: string; text?: string }) => jobs.run('resolve', () => api('POST', `/api/projects/${project.id}/prepare/resolve`, body));
  return (
    <div className="agent">
      <h3>Fabrication assistant</h3>
      <JobStatus job={jobs.jobs.check} label="Check" onRetry={onRecheck} />
      <JobStatus job={jobs.jobs.resolve} label="Fix" />
      <div className="chat tall">
        {ws.prepare.chat.map((t, i) => (
          <div key={i} className={'msg ' + t.role}>
            {t.fixCall && <code className="fixcall">{t.fixCall.tool}({JSON.stringify(t.fixCall.args)})</code>}
            {t.text}
          </div>
        ))}
      </div>
      {report && report.options.length > 0 && !busy && (
        <div className="options">
          <p className="small muted">Choose a remedy:</p>
          {report.options.map((o) => (
            <button key={o.id} className="option" onClick={() => resolve({ optionId: o.id })} title={o.description}>
              <b>{o.label}</b>
              <small>{o.description}</small>
            </button>
          ))}
        </div>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          resolve({ text });
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or say how to fix it…" disabled={busy} />
        <button disabled={busy || !text.trim()}>Send</button>
      </form>
      <div className="row wrap">
        <button onClick={onRecheck} disabled={busy}>
          Re-check
        </button>
        <button className="primary" onClick={onExport} disabled={busy}>
          {ws.prepare.issues.length ? 'Proceed to export anyway' : 'Proceed to export'}
        </button>
      </div>
    </div>
  );
}

function ExportPanel({ project, ws, jobs, onClose }: WsProps & { onClose: () => void }) {
  const [files, setFiles] = useState<LayerFiles[] | null>(null);
  const [formats, setFormats] = useState<('svg' | 'png')[]>(['svg', 'png']);
  const [layers, setLayers] = useState<string[]>(ws.canvas!.layers.map((l) => l.id));
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    jobs.run('export', () => api('POST', `/api/projects/${project.id}/export/render`)).then((j) => {
      if (j?.status === 'done') setFiles(j.result as LayerFiles[]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/export/zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formats, layerIds: layers }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name.replace(/[^\w-]+/g, '_')}-layers.zip`;
      a.click();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="export panel">
      <div className="row between">
        <h3>Export fabrication files</h3>
        <button className="link" onClick={onClose}>
          close
        </button>
      </div>
      <JobStatus job={jobs.jobs.export} label="Export rendering" />
      {files && (
        <>
          <p className="small muted">Review cut (red) and engrave (blue) paths per layer, then choose what to export.</p>
          <div className="export-grid">
            {files.map((f) => (
              <label key={f.layerId} className={'export-card' + (layers.includes(f.layerId) ? ' on' : '')}>
                <input type="checkbox" checked={layers.includes(f.layerId)} onChange={() => setLayers(toggle(layers, f.layerId))} />
                <b>
                  {f.depth + 1}. {f.name}
                </b>
                <div className="pair">
                  <img src={fileUrl(project, f.svgFile)} title="SVG cut/engrave" />
                  <img src={fileUrl(project, f.pngFile)} title="PNG" />
                </div>
              </label>
            ))}
          </div>
          <div className="row">
            <label>
              <input type="checkbox" checked={formats.includes('svg')} onChange={() => setFormats(toggle(formats, 'svg'))} /> SVG (cut & engrave)
            </label>
            <label>
              <input type="checkbox" checked={formats.includes('png')} onChange={() => setFormats(toggle(formats, 'png'))} /> PNG
            </label>
            <button className="primary" disabled={downloading || !formats.length || !layers.length} onClick={download}>
              {downloading ? 'Packaging…' : 'Download ZIP'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
