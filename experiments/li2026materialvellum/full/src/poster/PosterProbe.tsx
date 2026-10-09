// Process 3 — Graphic poster design.
import { useEffect, useMemo, useRef, useState } from 'react';
import { POSTER_SIZE, SAND_CELL, SAND_RES, brushSand, detectClusters, emptySand, type SandCluster, type SandGrid, type SandTool } from '../tools/sand';
import { composeSpecs, transcriptToRole } from '../tools/posterPre';
import { composePoster, svgToPng } from '../tools/posterCompose';
import { GenStatus, SvgImage, VersionStrip, post, useGen } from '../shared/ui';
import { ELEMENT_ROLES, type ElementRole, type ElementSpec, type ImageElement, type PosterImageRes, type PosterTextRes, type TextElement } from '../shared/api';

type Tool = SandTool | 'label';
const ROLE_COLOR: Record<ElementRole, string> = { title: '#e74c3c', subtitle: '#e67e22', body: '#2980b9', image: '#27ae60', decoration: '#8e44ad' };

// Web Speech API (Chrome: webkitSpeechRecognition)
const SpeechRec: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

function drawSand(ctx: CanvasRenderingContext2D, g: SandGrid) {
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, POSTER_SIZE, POSTER_SIZE);
  for (let k = 0; k < g.length; k++) {
    const d = g[k];
    if (d < 0.02) continue;
    const i = k % SAND_RES, j = Math.floor(k / SAND_RES);
    const grains = Math.ceil(d * 22);
    let s = k * 7919;
    for (let n = 0; n < grains; n++) {
      s = (s * 16807) % 2147483647; const rx = s / 2147483647;
      s = (s * 16807) % 2147483647; const ry = s / 2147483647;
      const shade = 150 - Math.round(d * 70 + rx * 25);
      ctx.fillStyle = `rgb(${shade + 50},${shade + 25},${shade - 20})`;
      ctx.fillRect(i * SAND_CELL + rx * SAND_CELL, j * SAND_CELL + ry * SAND_CELL, 1.6, 1.6);
    }
  }
}

export function PosterProbe() {
  // poster_theme_1 + poster_canvas_1
  const [theme, setTheme] = useState('Night market festival');
  // sand_clusters (human specify / human modify)
  const [sand, setSand] = useState<SandGrid>(emptySand);
  const [clusters, setClusters] = useState<SandCluster[]>([]);
  const [tool, setTool] = useState<Tool>('pour');
  const [radius, setRadius] = useState(28);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef(new Map<number, [number, number]>());
  // spoken_roles (human specify, audio → transcript)
  const [spoken, setSpoken] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [typed, setTyped] = useState('');
  // outputs
  const [specs, setSpecs] = useState<ElementSpec[]>([]);
  const [texts, setTexts] = useState<TextElement[]>([]);
  const [images, setImages] = useState<ImageElement[]>([]);
  const [posters, setPosters] = useState<{ label: string; svg: string }[]>([]);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState('');
  const gen = useGen();

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawSand(ctx, sand);
    // sand_clusters: re-detected after every pour / push / erase, keeping ids stable
    setClusters((cs) => detectClusters(sand, cs));
  }, [sand]);

  // spoken_roles_1 -> [tool_3 translate] -> element_roles_1
  const roles = useMemo(() => {
    const r: Record<string, ElementRole> = {};
    for (const c of clusters) {
      const role = spoken[c.id] ? transcriptToRole(spoken[c.id]) : null;
      if (role) r[c.id] = role;
    }
    return r;
  }, [clusters, spoken]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const b = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - b.left) / b.width) * POSTER_SIZE, ((e.clientY - b.top) / b.height) * POSTER_SIZE];
  };
  function apply(p: [number, number], prev: [number, number]) {
    if (tool === 'label') return;
    if (tool === 'push') {
      setSand((g) => brushSand(g, p[0], p[1], p[0] - prev[0], p[1] - prev[1], tool, radius));
      return;
    }
    // stamp along the stroke so fast swipes leave a continuous trail
    const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / (radius / 3)));
    setSand((g) => {
      let out = g;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        out = brushSand(out, prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t, 0, 0, tool, radius);
      }
      return out;
    });
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = pos(e);
    if (tool === 'label') {
      const hit = clusters.find((c) => p[0] >= c.bbox.x && p[0] <= c.bbox.x + c.bbox.w && p[1] >= c.bbox.y && p[1] <= c.bbox.y + c.bbox.h);
      setSelected(hit?.id ?? null);
      setTyped(hit ? spoken[hit.id] ?? '' : '');
      if (hit && SpeechRec) listen(hit.id);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current.set(e.pointerId, p);
    apply(p, [p[0] - 0.001, p[1]]);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const prev = last.current.get(e.pointerId);
    if (!prev) return;
    const p = pos(e);
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < (tool === 'push' ? SAND_CELL : 3)) return;
    last.current.set(e.pointerId, p);
    apply(p, prev);
  }
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => last.current.delete(e.pointerId);

  function listen(clusterId: string) {
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      const t = ev.results[0][0].transcript as string;
      setSpoken((s) => ({ ...s, [clusterId]: t }));
      setTyped(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  // element_specs → model_2 → model_1 → compose
  async function makePoster() {
    // poster_theme_1 + sand_clusters_2 + element_roles_1 -> [tool_3 compose] -> element_specs_1
    const sp = composeSpecs(theme, clusters, roles);
    setSpecs(sp);
    if (!sp.length) return;
    await gen.run(async () => {
      setPhase('model_2 writes the poster text');
      const t = await post<PosterTextRes>('/api/poster/text', { theme, specs: sp });
      setTexts(t.texts);
      setPhase('model_1 paints transparent images');
      const im = await post<PosterImageRes>('/api/poster/images', { specs: sp, texts: t.texts });
      setImages(im.images);
      // element_specs_1 + text_elements_1 + image_elements_1 -> [tool_3 compose] -> poster_1
      const svg = composePoster(sp, t.texts, im.images);
      setPosters((ps) => {
        const next = [...ps, { label: `poster ${ps.length + 1}`, svg }];
        setCurrent(next.length - 1);
        return next;
      });
    });
    setPhase('');
  }

  async function download() {
    const p = posters[current];
    if (!p) return;
    const a = document.createElement('a');
    a.href = await svgToPng(p.svg);
    a.download = `${p.label.replace(/\s+/g, '-')}.png`;
    a.click();
  }

  const unlabeled = clusters.filter((c) => !roles[c.id]);
  const sel = clusters.find((c) => c.id === selected);
  return (
    <div className="probe">
      <aside className="panel">
        <h2>Graphic poster</h2>
        <label className="field">Theme<input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Design theme" /></label>
        <p>Pour sand to add elements, then push or erase it to reshape them. A cluster's <b>area</b> sets the element's size and its <b>density</b> sets its visual weight.</p>
        <div className="chips">
          <button className={tool === 'pour' ? 'chip active' : 'chip'} onClick={() => setTool('pour')}>✋ Pour sand</button>
          <button className={tool === 'push' ? 'chip active' : 'chip'} onClick={() => setTool('push')}>👉 Push</button>
          <button className={tool === 'erase' ? 'chip active' : 'chip'} onClick={() => setTool('erase')}>🧽 Brush away</button>
          <button className={tool === 'label' ? 'chip active' : 'chip'} onClick={() => setTool('label')}>🎤 Label by voice</button>
        </div>
        {tool !== 'label' && <label className="field">Hand size <input type="range" min={10} max={60} value={radius} onChange={(e) => setRadius(+e.target.value)} /></label>}
        {tool === 'label' && (
          <div className="voice">
            <p className="small">Tap a cluster and say what it is: "title", "subtitle", "body text", "image" or "decoration".{!SpeechRec && ' Speech recognition is unavailable in this browser, so type the label instead.'}</p>
            {sel ? (
              <>
                <div className="row">
                  <b>{sel.id}</b>
                  {SpeechRec && <button disabled={listening} onClick={() => listen(sel.id)}>{listening ? '● listening…' : '🎤 Speak again'}</button>}
                </div>
                <input value={typed} placeholder="heard / typed label" onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setSpoken((s) => ({ ...s, [sel.id]: typed }))}
                  onBlur={() => typed && setSpoken((s) => ({ ...s, [sel.id]: typed }))} />
                {spoken[sel.id] && !roles[sel.id] && <p className="warn">“{spoken[sel.id]}” is not a known role. Try one of: {ELEMENT_ROLES.join(', ')}</p>}
              </>
            ) : <p className="muted">No cluster selected.</p>}
          </div>
        )}
        <div className="row">
          <button onClick={() => { setSand(emptySand()); setClusters([]); setSpoken({}); }}>Clear sand</button>
        </div>
        {unlabeled.length > 0 && clusters.length > 0 && <p className="warn">{unlabeled.length} cluster(s) without a role will be left out.</p>}
        <button className="primary" disabled={gen.busy || !Object.keys(roles).length || !theme.trim()} onClick={makePoster}>{posters.length ? 'Generate again' : 'Generate poster →'}</button>
        <GenStatus busy={gen.busy} error={gen.error} label={phase || 'generating'} />
      </aside>

      <section className="stage">
        <div className="layered" style={{ width: POSTER_SIZE, height: POSTER_SIZE }}>
          <canvas ref={canvas} width={POSTER_SIZE} height={POSTER_SIZE} className="surface sand" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          <svg className="overlay passthrough" viewBox={`0 0 ${POSTER_SIZE} ${POSTER_SIZE}`}>
            {clusters.map((c) => {
              const role = roles[c.id];
              const col = role ? ROLE_COLOR[role] : '#555';
              return (
                <g key={c.id}>
                  <rect x={c.bbox.x} y={c.bbox.y} width={c.bbox.w} height={c.bbox.h} fill="none" stroke={col} strokeWidth={c.id === selected ? 3 : 1.5} strokeDasharray={role ? undefined : '4 3'} />
                  <text x={c.bbox.x + 3} y={c.bbox.y - 4} fontSize={11} fill={col} fontWeight={700}>
                    {c.id}{role ? ` · ${role}` : ''} · size {(c.size * 100).toFixed(0)}% · density {(c.density * 100).toFixed(0)}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      <aside className="panel right">
        {specs.length > 0 && (
          <>
            <h4>element_specs</h4>
            <table className="specs">
              <thead><tr><th>id</th><th>role</th><th>box</th><th>weight</th></tr></thead>
              <tbody>{specs.map((s) => <tr key={s.clusterId}><td>{s.clusterId}</td><td>{s.role}</td><td>{Math.round(s.x)},{Math.round(s.y)} {Math.round(s.w)}×{Math.round(s.h)}</td><td>{s.weight.toFixed(2)}</td></tr>)}</tbody>
            </table>
          </>
        )}
        {texts.length > 0 && (<><h4>text_elements</h4><ul className="small">{texts.map((t) => <li key={t.clusterId}><b>{t.clusterId}</b>: {t.text}</li>)}</ul></>)}
        {images.length > 0 && (
          <><h4>image_elements</h4><div className="gallery">{images.map((i) => <div key={i.clusterId}><SvgImage svg={i.svg} alt={i.clusterId} checker /><span className="small">{i.clusterId}</span></div>)}</div></>
        )}
        {posters[current] && (
          <>
            <h4>poster</h4>
            <SvgImage svg={posters[current].svg} alt="poster" />
            <VersionStrip versions={posters} current={current} onPick={setCurrent} />
            <button onClick={download}>Download PNG</button>
          </>
        )}
      </aside>
    </div>
  );
}
