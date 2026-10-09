import { useEffect, useState } from 'react';
import { api, type Project } from '../api.ts';

/** Starts process 1: the researcher uploads paper_1. */
export function Upload({ onCreated }: { onCreated: (p: Project) => void }) {
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof api.list>>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => { api.list().then(setProjects).catch(() => {}); }, []);

  async function send(file?: File) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { setError('Please choose a PDF file'); return; }
    setUploading(true); setError(null);
    try { onCreated(await api.upload(file)); } catch (e) { setError((e as Error).message); } finally { setUploading(false); }
  }

  return (
    <div className="home">
      <h1>Turn your paper into a 60-second science video</h1>
      <p className="muted">Upload an academic PDF. You'll pick a hook and script, set the voiceover, review scene by scene, and export a vertical MP4 with captions and credits.</p>
      <label
        className={`drop ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files[0]); }}
      >
        <input type="file" accept="application/pdf" hidden onChange={(e) => send(e.target.files?.[0])} disabled={uploading} />
        {uploading ? <><span className="spinner" /> Reading the PDF…</> : <>Drop a PDF here or <u>browse</u></>}
      </label>
      {error && <div className="error">{error}</div>}
      {projects.length > 0 && (
        <>
          <h3>Previous projects</h3>
          <ul className="projects">
            {projects.map((p) => (
              <li key={p.id}><a href={`#/p/${p.id}`}>{p.title}</a> <span className="muted">{new Date(p.createdAt).toLocaleString()}{p.hasVideo ? ' · video ready' : ''}</span></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
