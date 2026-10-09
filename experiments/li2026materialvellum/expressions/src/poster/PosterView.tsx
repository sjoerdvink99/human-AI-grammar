/** Process 3 — theme + sand clusters + spoken roles → element specs → text (model_2) → images (model_1) → poster. */
import { useRef, useState } from 'react';
import { api, svgDataUrl } from '../api';
import { bbox, canvasPoint, uid } from '../geom';
import { download, ErrorBox, Generating, Rep, Step } from '../components';
import { closeOutline, paletteFor, POSTER, tool3ComposePoster, tool3ComposeSpecs, tool3SpeechToRoles } from './tools';
import type { ElementRole, ElementSpec, ImageElement, SandCluster, SpokenRole, TextElement } from './types';
import type { Point } from '../shared/api';

type Phase = 'pour' | 'shape' | 'speak' | 'generate';

const ROLE_COLORS: Record<string, string> = {
  title: '#d2462f', subtitle: '#e98b2a', body: '#3b7dd8', date: '#7a4fd1', caption: '#2f8f5b', image: '#c23b6a', unknown: '#888',
};

export default function PosterView() {
  const [poster_theme_1, setTheme] = useState('');
  const [phase, setPhase] = useState<Phase>('pour');
  const [sand_clusters_1, setClusters1] = useState<SandCluster[]>([]);
  const [sand_clusters_2, setClusters2] = useState<SandCluster[]>([]);
  const [spoken_roles_1, setSpoken] = useState<SpokenRole[]>([]);
  const [element_roles_1, setRoles] = useState<ElementRole[] | null>(null);
  const [element_specs_1, setSpecs] = useState<ElementSpec[] | null>(null);
  const [text_elements_1, setTexts] = useState<TextElement[] | null>(null);
  const [image_elements_1, setImages] = useState<ImageElement[] | null>(null);
  const [poster_1, setPoster] = useState<string | null>(null);
  const [posters, setPosters] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clusters = phase === 'pour' ? sand_clusters_1 : sand_clusters_2;

  function finishPouring() {
    setClusters2(sand_clusters_1.map((c) => ({ ...c, points: c.points.slice() })));
    setPhase('shape');
  }

  async function generatePoster() {
    setError(null);
    const roles = tool3SpeechToRoles(spoken_roles_1); // [tool_3 translate]
    setRoles(roles);
    const specs = tool3ComposeSpecs(poster_theme_1, sand_clusters_2, roles); // [tool_3 compose]
    setSpecs(specs);
    setTexts(null); setImages(null); setPoster(null);
    if (!specs.length) {
      setError('No cluster got a recognisable role. Re-record saying e.g. "title", "picture", "body text", "date".');
      return;
    }
    setPhase('generate');
    try {
      setBusy('model_2 is writing the poster text…');
      const { text_elements } = await api.generatePosterText({ poster_theme: poster_theme_1, element_specs: specs }); // [model_2 generate]~
      setTexts(text_elements);
      setBusy('model_1 is generating the images…');
      const { image_elements } = await api.generatePosterImages({ element_specs: specs, text_elements }); // [model_1 generate]~
      setImages(image_elements);
      const poster = tool3ComposePoster(specs, text_elements, image_elements, sand_clusters_2); // [tool_3 compose]
      setPoster(poster);
      setPosters((p) => [...p, poster]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function exportPng() {
    if (!poster_1) return;
    const img = new Image();
    img.src = svgDataUrl(poster_1);
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = POSTER.width * 3; cv.height = POSTER.height * 3;
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png'); a.download = 'poster.png'; a.click();
  }

  const unknownCount = element_roles_1?.filter((r) => r.role === 'unknown').length ?? 0;

  return (
    <div className="workspace">
      <section className="stage">
        <label className="theme">
          <span>poster_theme_1</span>
          <input value={poster_theme_1} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. A night-market food festival by the river" disabled={phase === 'generate'} />
        </label>

        <div className="tabs-inline">
          {(['pour', 'shape', 'speak', 'generate'] as const).map((p, i) => (
            <span key={p} className={phase === p ? 'on' : ''}>{i + 1}. {p === 'pour' ? 'pour sand' : p === 'shape' ? 'shape sand' : p === 'speak' ? 'speak roles' : 'poster'}</span>
          ))}
        </div>

        {phase !== 'generate' && (
          <>
            <p className="hint">
              {phase === 'pour' && 'Draw a closed outline to pour a heap of sand where an element of the poster should go.'}
              {phase === 'shape' && 'Push the sand around: drag a heap to move it, drag its corner handle to resize, double-click to sweep it away.'}
              {phase === 'speak' && 'For each heap, press the microphone and say what it is: "title", "subtitle", "a picture", "body text", "the date", "caption"…'}
            </p>
            <div className="row">
              <SandBox
                clusters={clusters}
                phase={phase}
                roles={element_roles_1}
                onAdd={(c) => setClusters1((x) => [...x, c])}
                onChange={setClusters2}
                theme={poster_theme_1}
              />
              {phase === 'speak' && (
                <div className="speak-list">
                  {sand_clusters_2.map((c, i) => (
                    <SpeakRow
                      key={c.id}
                      index={i + 1}
                      value={spoken_roles_1.find((s) => s.clusterId === c.id)}
                      onChange={(s) => setSpoken((all) => [...all.filter((x) => x.clusterId !== c.id), s])}
                      clusterId={c.id}
                    />
                  ))}
                </div>
              )}
            </div>
            <ErrorBox error={error} />
            <div className="actions">
              {phase === 'pour' && (
                <>
                  <button onClick={() => setClusters1((x) => x.slice(0, -1))} disabled={!sand_clusters_1.length}>Undo</button>
                  <button onClick={() => setClusters1([])} disabled={!sand_clusters_1.length}>Clear</button>
                  <button className="primary" onClick={finishPouring} disabled={!sand_clusters_1.length}>Done pouring →</button>
                </>
              )}
              {phase === 'shape' && (
                <>
                  <button onClick={() => setPhase('pour')}>← Pour more</button>
                  <button onClick={finishPouring}>Reset shapes</button>
                  <button className="primary" onClick={() => setPhase('speak')} disabled={!sand_clusters_2.length}>Done shaping →</button>
                </>
              )}
              {phase === 'speak' && (
                <>
                  <button onClick={() => setPhase('shape')}>← Shape sand</button>
                  <button className="primary" disabled={!poster_theme_1.trim() || !sand_clusters_2.every((c) => spoken_roles_1.some((s) => s.clusterId === c.id && s.transcript.trim()))} onClick={generatePoster}>
                    Make poster →
                  </button>
                  {!poster_theme_1.trim() && <span className="muted small">enter a theme first</span>}
                </>
              )}
            </div>
          </>
        )}

        {phase === 'generate' && (
          <>
            {unknownCount > 0 && <div className="warn">{unknownCount} heap(s) had no recognisable role and were left out.</div>}
            {busy && <Generating label={busy} />}
            <ErrorBox error={error} onRetry={generatePoster} />
            <div className="row">
              {poster_1 && <img className="poster" src={svgDataUrl(poster_1)} />}
              {posters.length > 1 && (
                <div className="history vertical">
                  {posters.map((p, i) => <img key={i} src={svgDataUrl(p)} className={p === poster_1 ? 'on' : ''} onClick={() => setPoster(p)} />)}
                </div>
              )}
            </div>
            <div className="actions">
              <button onClick={() => setPhase('speak')} disabled={!!busy}>← Back to sand</button>
              <button onClick={generatePoster} disabled={!!busy}>Regenerate</button>
              {poster_1 && <button onClick={() => download('poster.svg', poster_1)}>Download SVG</button>}
              {poster_1 && <button className="primary" onClick={exportPng}>Download PNG</button>}
            </div>
          </>
        )}
      </section>

      <aside className="pipeline">
        <h3>Process 3</h3>
        <Rep id="poster_theme_1" role="instruction" medium="language">{poster_theme_1 || '—'}</Rep>
        <Rep id="poster_canvas_1" role="artifact" medium="spatial" />
        <Step actor="human" op="specify" done={phase !== 'pour'} />
        <Rep id="sand_clusters_1" role="instruction" medium="spatial*" active={phase === 'pour'}>{sand_clusters_1.length} heaps</Rep>
        <Step actor="human" op="modify" done={phase === 'speak' || phase === 'generate'} />
        <Rep id="sand_clusters_2" role="instruction" medium="spatial*" active={phase === 'shape'}>{phase === 'pour' ? '—' : `${sand_clusters_2.length} heaps`}</Rep>
        <Step actor="human" op="specify" done={!!element_roles_1} />
        <Rep id="spoken_roles_1" role="instruction" medium="audio*" active={phase === 'speak'}>
          <ul className="small">{spoken_roles_1.map((s) => <li key={s.clusterId}>“{s.transcript}”</li>)}</ul>
        </Rep>
        <Step actor="tool_3" op="translate" done={!!element_roles_1} />
        <Rep id="element_roles_1" role="label" medium="categorical*">
          {element_roles_1?.map((r) => <span key={r.clusterId} className="tag" style={{ background: ROLE_COLORS[r.role] }}>{r.role}</span>)}
        </Rep>
        <Step actor="tool_3" op="compose" done={!!element_specs_1} />
        <Rep id="element_specs_1" role="instruction" medium="record*">
          {element_specs_1 && <pre className="small">{JSON.stringify(element_specs_1.map(({ theme: _t, bbox: b, ...s }) => ({ ...s, bbox: `${Math.round(b.w)}×${Math.round(b.h)}` })), null, 1)}</pre>}
        </Rep>
        <Step actor="model_2" op="generate" generative done={!!text_elements_1} running={busy?.startsWith('model_2')} />
        <Rep id="text_elements_1" role="artifact" medium="language*">
          {text_elements_1 && <ul className="small">{text_elements_1.map((t) => <li key={t.id}>{t.text}</li>)}</ul>}
        </Rep>
        <Step actor="model_1" op="generate" generative done={!!image_elements_1} running={busy?.startsWith('model_1')} />
        <Rep id="image_elements_1" role="artifact" medium="visual*">
          <div className="thumbs">{image_elements_1?.map((i) => <img key={i.id} className="mini" src={svgDataUrl(i.svg)} />)}</div>
        </Rep>
        <Step actor="tool_3" op="compose" done={!!poster_1} />
        <Rep id="poster_1" role="artifact" medium="visual" active={!!poster_1}>{poster_1 && <img className="thumb" src={svgDataUrl(poster_1)} />}</Rep>
      </aside>
    </div>
  );
}

// --------------------------------------------------------------- sand box

function SandBox({ clusters, phase, roles, onAdd, onChange, theme }: {
  clusters: SandCluster[]; phase: Phase; roles: ElementRole[] | null; theme: string;
  onAdd: (c: SandCluster) => void; onChange: (c: SandCluster[]) => void;
}) {
  const { width: W, height: H } = POSTER;
  const [lasso, setLasso] = useState<Point[] | null>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'scale'; start: Point; orig: Point[] } | null>(null);
  const pal = paletteFor(theme || ' ');

  function down(e: React.PointerEvent<SVGSVGElement>) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = canvasPoint(e, e.currentTarget, W, H);
    if (phase === 'pour') setLasso([p]);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const p = canvasPoint(e, e.currentTarget, W, H);
    if (lasso) { setLasso([...lasso, p]); return; }
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    let pts: Point[];
    if (d.mode === 'move') pts = d.orig.map((q) => ({ x: q.x + dx, y: q.y + dy }));
    else {
      const b = bbox(d.orig);
      const sx = Math.max(0.15, (b.w + dx) / b.w), sy = Math.max(0.15, (b.h + dy) / b.h);
      pts = d.orig.map((q) => ({ x: b.x + (q.x - b.x) * sx, y: b.y + (q.y - b.y) * sy }));
    }
    onChange(clusters.map((c) => (c.id === d.id ? { ...c, points: pts.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })) } : c)));
  }
  function up() {
    if (lasso && lasso.length > 8) {
      const outline = closeOutline(lasso);
      const b = bbox(outline);
      if (b.w > 12 && b.h > 12) onAdd({ id: uid('c'), points: outline });
    }
    setLasso(null);
    drag.current = null;
  }
  const startDrag = (e: React.PointerEvent, c: SandCluster, mode: 'move' | 'scale') => {
    if (phase !== 'shape') return;
    e.stopPropagation();
    ((e.currentTarget as SVGElement).ownerSVGElement as Element).setPointerCapture(e.pointerId);
    drag.current = { id: c.id, mode, start: canvasPoint(e, (e.currentTarget as SVGElement).ownerSVGElement!, W, H), orig: c.points };
  };

  return (
    <svg className="board poster-board" viewBox={`0 0 ${W} ${H}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <defs>
        <pattern id="sand" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#d9b779" />
          <circle cx="1.5" cy="1.5" r="0.9" fill="#b8955a" />
          <circle cx="4.5" cy="4" r="0.7" fill="#ead2a0" />
        </pattern>
        <filter id="grain"><feTurbulence baseFrequency="0.9" numOctaves="1" /><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 0.08 0" /></filter>
      </defs>
      <rect width={W} height={H} fill={pal.bg} />
      <rect width={W} height={H} filter="url(#grain)" />
      {clusters.map((c, i) => {
        const b = bbox(c.points);
        const role = roles?.find((r) => r.clusterId === c.id)?.role;
        return (
          <g key={c.id} className={phase === 'shape' ? 'draggable' : ''}>
            <polygon
              points={c.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="url(#sand)" stroke="#a88147" strokeWidth={1.5}
              onPointerDown={(e) => startDrag(e, c, 'move')}
              onDoubleClick={() => phase === 'shape' && onChange(clusters.filter((x) => x.id !== c.id))}
            />
            <circle cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={11} fill="#fff" stroke="#a88147" pointerEvents="none" />
            <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} textAnchor="middle" fontSize={12} pointerEvents="none">{i + 1}</text>
            {role && <text x={b.x + 4} y={b.y - 4} fontSize={11} fill={ROLE_COLORS[role]} fontWeight={700}>{role}</text>}
            {phase === 'shape' && (
              <rect x={b.x + b.w - 6} y={b.y + b.h - 6} width={12} height={12} fill="#fff" stroke="#333" className="handle" onPointerDown={(e) => startDrag(e, c, 'scale')} />
            )}
          </g>
        );
      })}
      {lasso && <polyline points={lasso.map((p) => `${p.x},${p.y}`).join(' ')} fill="#d9b77955" stroke="#a88147" strokeDasharray="4 3" />}
    </svg>
  );
}

// --------------------------------------------------------------- speech

/* eslint-disable @typescript-eslint/no-explicit-any */
const SpeechRecognitionCtor: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

function SpeakRow({ index, clusterId, value, onChange }: { index: number; clusterId: string; value?: SpokenRole; onChange: (s: SpokenRole) => void }) {
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});

  async function start() {
    setNote(null);
    let transcript = '';
    let audioUrl: string | undefined;
    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    const chunks: Blob[] = [];
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
    } catch {
      setNote('No microphone available — type what you would say instead.');
    }
    const rec = SpeechRecognitionCtor ? new SpeechRecognitionCtor() : null;
    if (rec) {
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.onresult = (ev: any) => { transcript = Array.from(ev.results as ArrayLike<any>).map((r: any) => r[0].transcript).join(' '); };
      rec.onerror = (ev: any) => setNote(`Speech recognition: ${ev.error}. You can type instead.`);
      rec.start();
    } else if (recorder) {
      setNote('This browser has no speech recognition — the audio is kept, but type the words too.');
    }
    if (!recorder && !rec) return;
    setRecording(true);
    stopRef.current = () => {
      setRecording(false);
      const finish = () => {
        if (chunks.length) audioUrl = URL.createObjectURL(new Blob(chunks, { type: recorder?.mimeType }));
        stream?.getTracks().forEach((t) => t.stop());
        // give recognition a moment to deliver its final result
        setTimeout(() => onChange({ clusterId, transcript: transcript || value?.transcript || '', audioUrl }), rec ? 600 : 0);
      };
      rec?.stop();
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = finish; recorder.stop(); } else finish();
    };
  }

  return (
    <div className="speak-row">
      <span className="badge">{index}</span>
      <button className={`mic ${recording ? 'rec' : ''}`} onClick={() => (recording ? stopRef.current() : start())} title="Record what this heap is">
        {recording ? '■ stop' : '🎤 speak'}
      </button>
      <input
        placeholder="…or type it"
        value={value?.transcript ?? ''}
        onChange={(e) => onChange({ clusterId, transcript: e.target.value, audioUrl: value?.audioUrl })}
      />
      {value?.audioUrl && <audio src={value.audioUrl} controls />}
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}
