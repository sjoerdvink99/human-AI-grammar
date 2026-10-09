import { useEffect, useMemo, useState } from "react";
import { api, type Project } from "../api.ts";
import type { Act } from "../App.tsx";
import { FORMATS, loadClip, renderVideo, translateTitle, type FormatId } from "../render.ts";

/** Process 7: title card (r30…r33), clip choice (r34*), format (r35), title clip (r36), final video (r37). */
export default function ExportView({ project, act }: { project: Project; act: Act }) {
  const p = project;
  const tc = p.titleCard;
  const ready = useMemo(() => p.scenes.filter((s) => s.audio && s.image), [p.scenes]);
  const [titleText, setTitleText] = useState(tc?.text ?? "");
  useEffect(() => setTitleText(tc?.text ?? ""), [tc?.text]);

  // r34*: chosen clips in order
  const [chosen, setChosen] = useState<string[]>(() => ready.map((s) => s.id));
  useEffect(() => setChosen((c) => c.filter((id) => ready.some((s) => s.id === id))), [ready]);
  const [format, setFormat] = useState<FormatId>("landscape"); // r35
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<{ url: string; ext: string; format: FormatId } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const move = (id: string, d: -1 | 1) =>
    setChosen((c) => {
      const i = c.indexOf(id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= c.length) return c;
      const n = [...c];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : ready.map((s) => s.id).filter((x) => x === id || c.includes(x))));

  async function render() {
    setErr(null);
    setVideo(null);
    setProgress(0);
    const audioCtx = new AudioContext();
    try {
      const title = await translateTitle(tc!.image!); // tool_2 translate r33 -> r36
      const clips = await Promise.all(chosen.map((id) => loadClip(ready.find((s) => s.id === id)!, audioCtx)));
      const { blob, ext } = await renderVideo([title, ...clips], format, audioCtx, setProgress); // tool_2 compose -> r37
      setVideo({ url: URL.createObjectURL(blob), ext, format });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      void audioCtx.close();
    }
  }

  const titleDirty = tc && titleText.trim() !== tc.text;
  const totalSeconds = 3.5 + chosen.reduce((t, id) => t + (ready.find((s) => s.id === id)?.duration ?? 0) + 0.35, 0);

  return (
    <section>
      <header>
        <h2>Export</h2>
        <p className="muted">Build a title card, choose and order the clips, pick a format, and render the video.</p>
      </header>

      <div className="panel">
        <h3>Title card</h3>
        {!tc ? (
          <button onClick={() => act(api.prepareTitle)}>Prepare title card</button>
        ) : (
          <div className="two-col">
            <div>
              <p className="muted small">Found in the document: {tc.metadata.length ? tc.metadata.join(" · ") : "nothing — using the concept title"}</p>
              <label className="field">
                <span>Title card text (first line is the title)</span>
                <textarea rows={4} value={titleText} onChange={(e) => setTitleText(e.target.value)} />
              </label>
              <div className="row">
                <button disabled={!titleText.trim() || (!titleDirty && !!tc.image)} onClick={() => act(() => api.composeTitle(titleText))}>
                  {tc.image ? "Update title card" : "Compose title card"}
                </button>
                <button className="secondary" onClick={() => act(api.prepareTitle)}>
                  Re-extract
                </button>
              </div>
            </div>
            <div className="frame">
              {tc.image ? <img src={tc.image} alt="Title card" /> : tc.frame ? <img src={tc.frame} alt="Background frame" className="dim" /> : null}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Clips</h3>
        <ol className="clip-list">
          {[...chosen.map((id) => ready.find((s) => s.id === id)!), ...ready.filter((s) => !chosen.includes(s.id))].map((s) => {
            const on = chosen.includes(s.id);
            const n = p.scenes.findIndex((x) => x.id === s.id) + 1;
            return (
              <li key={s.id} className={on ? "" : "off"}>
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                <img src={s.image!} alt="" />
                <span className="grow small">
                  <strong>Scene {n}</strong> · {s.duration?.toFixed(1)}s — {s.text}
                </span>
                {on && (
                  <span className="order">
                    <button className="icon" onClick={() => move(s.id, -1)} title="Move up">
                      ↑
                    </button>
                    <button className="icon" onClick={() => move(s.id, 1)} title="Move down">
                      ↓
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="panel">
        <h3>Format</h3>
        <div className="segmented">
          {(Object.keys(FORMATS) as FormatId[]).map((f) => (
            <button key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>
              {FORMATS[f].label}
            </button>
          ))}
        </div>
        <div className="row">
          <button disabled={!tc?.image || !chosen.length || progress !== null} onClick={render}>
            Render video
          </button>
          <span className="muted">
            {chosen.length} clips + title · ≈ {totalSeconds.toFixed(0)}s · rendering runs in real time — keep this tab visible
          </span>
        </div>
        {!tc?.image && <p className="muted small">Compose the title card first.</p>}
        {progress !== null && (
          <div className="bar wide">
            <div style={{ width: `${progress * 100}%` }} />
            <span>Rendering {Math.round(progress * 100)}%</span>
          </div>
        )}
        {err && <div className="banner error">{err}</div>}
        {video && (
          <div className={`result ${video.format}`}>
            <video controls src={video.url} />
            <a className="button" href={video.url} download={`${(p.concept?.title || "video").replace(/[^\w-]+/g, "_")}.${video.ext}`}>
              Download .{video.ext}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
