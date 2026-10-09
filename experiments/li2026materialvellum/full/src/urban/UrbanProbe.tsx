// Process 1 — Urban neighborhood design.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CELL, DENSITY_RES, FUNCTIONS, FUNCTION_ICON, N_BLOCKS, RENDER_SIZE, SITE, STREET, ZONES, ZONE_COLOR, urbanSite1,
  type DensityGrid, type Magnet, type UrbanFunction, type UrbanPlan, type Vec, type Zone, type ZoningBand,
} from './types';
import { relaxBands, stepMagnets, compatibility, type BandPin } from '../tools/physics';
import { composePlan, initDensity, sculpt, magnetsToMasks, compositeInpaint, type ClayMode } from '../tools/urbanPre';
import { buildCity, updateCityHeights, renderDepthMap, CityView, type CityModel } from '../tools/city3d';
import { dist, resampleClosed, uid } from '../tools/geometry';
import { GenStatus, Step, SvgImage, VersionStrip, post, useGen } from '../shared/ui';
import type { InpaintMask, SvgRes, UrbanInpaintRes } from '../shared/api';

type Stage = 'zoning' | 'density' | 'functions';

function toLocal(svg: SVGSVGElement, e: React.PointerEvent): Vec {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  return [p.x, p.y];
}

export function UrbanProbe() {
  const [stage, setStage] = useState<Stage>('zoning');

  // ---- zoning_bands (human specify, tool_1 modify)
  const [zone, setZone] = useState<Zone>('residential');
  const [bands, setBands] = useState<ZoningBand[]>([]);
  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const strokes = useRef(new Map<number, Vec[]>()); // pointerId → freehand stroke
  const pins = useRef(new Map<number, BandPin>()); // pointerId → held band vertex
  const [, force] = useState(0);
  const zoningSvg = useRef<SVGSVGElement>(null);

  // ---- urban_plan, city_model, density_grid
  const [plan, setPlan] = useState<UrbanPlan | null>(null);
  const [city, setCity] = useState<CityModel | null>(null);
  const [density, setDensity] = useState<DensityGrid | null>(null);
  const [clayMode, setClayMode] = useState<ClayMode>('raise');
  const [brush, setBrush] = useState(2.5);
  const viewHost = useRef<HTMLDivElement>(null);
  const view = useRef<CityView | null>(null);
  const clayPointers = useRef(new Set<number>());
  const claySvg = useRef<SVGSVGElement>(null);

  // ---- depth_map, render versions
  const [depth, setDepth] = useState<{ png: string; grid: number[][] } | null>(null);
  const [renders, setRenders] = useState<{ label: string; svg: string }[]>([]);
  const [current, setCurrent] = useState(0);
  const gen = useGen();

  // ---- function_magnets, masks
  const [magnets, setMagnets] = useState<Magnet[]>([]);
  const magnetsRef = useRef<Magnet[]>([]);
  magnetsRef.current = magnets;
  const [placing, setPlacing] = useState<UrbanFunction | null>('park');
  const dragging = useRef(new Map<number, string>()); // pointerId → magnet id
  const [lastMasks, setLastMasks] = useState<{ masks: InpaintMask[]; prompts: string[] } | null>(null);
  const magnetSvg = useRef<SVGSVGElement>(null);

  // ===================================================== zoning gestures
  function zoningDown(e: React.PointerEvent<SVGSVGElement>) {
    const p = toLocal(e.currentTarget, e);
    e.currentTarget.setPointerCapture(e.pointerId);
    // grab a band vertex if close: stretch the elastic band
    for (const b of bands) {
      const idx = b.points.findIndex((q) => dist(p, q) < 14);
      if (idx >= 0) { pins.current.set(e.pointerId, { bandId: b.id, index: idx, pos: p }); setSelectedBand(b.id); return; }
    }
    strokes.current.set(e.pointerId, [p]);
    force((x) => x + 1);
  }
  function zoningMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = toLocal(e.currentTarget, e);
    const pin = pins.current.get(e.pointerId);
    if (pin) {
      pin.pos = p;
      setBands((bs) => relaxBands(bs, SITE, [...pins.current.values()], 4));
      return;
    }
    const s = strokes.current.get(e.pointerId);
    if (s && dist(s[s.length - 1], p) > 4) { s.push(p); force((x) => x + 1); }
  }
  function zoningUp(e: React.PointerEvent<SVGSVGElement>) {
    if (pins.current.delete(e.pointerId)) {
      setBands((bs) => relaxBands(bs, SITE, [...pins.current.values()], 20));
      return;
    }
    const s = strokes.current.get(e.pointerId);
    strokes.current.delete(e.pointerId);
    if (s && s.length > 8) {
      const band: ZoningBand = { id: uid('band'), zone, points: resampleClosed(s, 40) };
      // zoning_bands_1 -> [tool_1 modify] -> zoning_bands_2
      setBands((bs) => relaxBands([...bs, band], SITE, [], 20));
      setSelectedBand(band.id);
    }
    force((x) => x + 1);
  }
  const livePlan = useMemo(() => composePlan(bands), [bands]);

  // zoning_bands_2 -> compose -> urban_plan_1 -> translate -> city_model_1 -> translate -> density_grid_1
  function buildCityFromBands() {
    const p = composePlan(bands);
    const c = buildCity(p, null);
    const d = initDensity(c.plan);
    setPlan(p); setCity(c); setDensity(d);
    setStage('density');
  }

  // ===================================================== 3D view lifecycle
  useEffect(() => {
    if (stage !== 'density' || !viewHost.current) return;
    const v = new CityView(viewHost.current);
    view.current = v;
    const onResize = () => v.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); v.dispose(); view.current = null; };
  }, [stage]);

  // density_grid_2 -> [tool_2 modify] -> city_model_2 (live while sculpting)
  useEffect(() => {
    if (!city || !density) return;
    const id = requestAnimationFrame(() => {
      const c2 = updateCityHeights(city, density);
      view.current?.show(c2);
    });
    return () => cancelAnimationFrame(id);
  }, [density, city, stage]);

  function clayAt(e: React.PointerEvent<SVGSVGElement>) {
    const [x, y] = toLocal(e.currentTarget, e);
    setDensity((g) => (g ? sculpt(g, x, y, brush, e.shiftKey ? (clayMode === 'raise' ? 'lower' : 'raise') : clayMode) : g));
  }

  // city_model_2 -> [tool_3 translate] -> depth_map_1 -> [model_1 generate]~ -> render_1
  async function renderNeighborhood(regenerate = false) {
    if (!city || !density) return;
    let d = depth;
    if (!regenerate || !d) {
      const c2 = updateCityHeights(city, density);
      d = renderDepthMap(c2);
      setDepth(d);
    }
    const res = await gen.run(() => post<SvgRes>('/api/urban/render', { depthGrid: d!.grid, size: RENDER_SIZE }));
    if (!res) return;
    setRenders((rs) => {
      const next = [...rs, { label: `render ${rs.length + 1}`, svg: res.svg }];
      setCurrent(next.length - 1);
      return next;
    });
    setStage('functions');
  }

  // ===================================================== magnets
  useEffect(() => {
    if (stage !== 'functions') return;
    let raf = 0;
    const tick = () => {
      // function_magnets_1 -> [tool_1 modify] -> function_magnets_2 (continuous)
      const ms = magnetsRef.current;
      if (ms.length > 1) {
        const next = stepMagnets(ms, RENDER_SIZE, [...dragging.current.values()], 2);
        const moved = next.some((m, i) => Math.abs(m.x - ms[i].x) + Math.abs(m.y - ms[i].y) > 0.05);
        if (moved) setMagnets(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  function magnetDown(e: React.PointerEvent<SVGSVGElement>) {
    const p = toLocal(e.currentTarget, e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const hit = magnets.find((m) => Math.hypot(m.x - p[0], m.y - p[1]) < 20);
    if (hit) { dragging.current.set(e.pointerId, hit.id); return; }
    if (placing) {
      const m: Magnet = { id: uid('mag'), fn: placing, x: p[0], y: p[1] };
      setMagnets((ms) => [...ms, m]);
      dragging.current.set(e.pointerId, m.id);
    }
  }
  function magnetMove(e: React.PointerEvent<SVGSVGElement>) {
    const id = dragging.current.get(e.pointerId);
    if (!id) return;
    const [x, y] = toLocal(e.currentTarget, e);
    setMagnets((ms) => ms.map((m) => (m.id === id ? { ...m, x: Math.max(20, Math.min(RENDER_SIZE - 20, x)), y: Math.max(20, Math.min(RENDER_SIZE - 20, y)) } : m)));
  }
  function magnetUp(e: React.PointerEvent<SVGSVGElement>) {
    dragging.current.delete(e.pointerId);
  }

  // render_1 + function_magnets_2 -> [tool_3 translate] -> masks + prompts -> [model_1 modify]~ -> render_2
  async function inpaint() {
    const base = renders[current];
    if (!base || !magnets.length) return;
    const mp = magnetsToMasks(magnets);
    setLastMasks(mp);
    const res = await gen.run(() => post<UrbanInpaintRes>('/api/urban/inpaint', { render: base.svg, masks: mp.masks, prompts: mp.prompts, size: RENDER_SIZE }));
    if (!res) return;
    const svg2 = compositeInpaint(base.svg, mp.masks, res.patches);
    setRenders((rs) => {
      const next = [...rs, { label: `${base.label} + ${magnets.map((m) => m.fn).join(', ')}`, svg: svg2 }];
      setCurrent(next.length - 1);
      return next;
    });
  }

  // ===================================================== render
  const activeStrokes = [...strokes.current.values()];
  const cellR = RENDER_SIZE / N_BLOCKS;
  return (
    <div className="probe">
      <aside className="panel">
        <h2>Urban neighborhood</h2>
        <p className="muted">Site: {urbanSite1.blocks}×{urbanSite1.blocks} blocks.</p>
        <Step n={1} title="Zoning bands" active={stage === 'zoning'} done={!!plan}>
          <p>Draw a closed loop to stretch an elastic band around a zone. Drag the band's points to stretch it (several fingers work at once). Bands stay on the site and do not overlap.</p>
          <div className="chips">
            {ZONES.map((z) => (
              <button key={z} className={z === zone ? 'chip active' : 'chip'} style={{ borderColor: ZONE_COLOR[z] }} onClick={() => setZone(z)}>
                <span className="dot" style={{ background: ZONE_COLOR[z] }} />{z}
              </button>
            ))}
          </div>
          <div className="row">
            <button disabled={!selectedBand} onClick={() => { setBands((bs) => bs.filter((b) => b.id !== selectedBand)); setSelectedBand(null); }}>Remove band</button>
            <button disabled={!selectedBand} onClick={() => setBands((bs) => bs.map((b) => (b.id === selectedBand ? { ...b, zone } : b)))}>Set zone</button>
          </div>
          <button className="primary" disabled={!bands.length} onClick={buildCityFromBands}>Build 3D city →</button>
        </Step>
        <Step n={2} title="Density clay" active={stage === 'density'} done={renders.length > 0}>
          <p>Shape building density like clay: press and drag on the density map. Hold Shift to reverse.</p>
          <div className="chips">
            {(['raise', 'lower', 'smooth'] as ClayMode[]).map((m) => (
              <button key={m} className={m === clayMode ? 'chip active' : 'chip'} onClick={() => setClayMode(m)}>{m}</button>
            ))}
          </div>
          <label className="field">Brush size <input type="range" min={1} max={6} step={0.5} value={brush} onChange={(e) => setBrush(+e.target.value)} /></label>
          <div className="row">
            <button onClick={() => setStage('zoning')}>← Zoning</button>
            <button onClick={() => city && setDensity(initDensity(city.plan))}>Reset clay</button>
          </div>
          <button className="primary" disabled={gen.busy} onClick={() => renderNeighborhood()}>Render neighborhood →</button>
        </Step>
        <Step n={3} title="Function magnets" active={stage === 'functions'} done={renders.length > 1}>
          <p>Pick a function and tap the render to drop a magnet. Compatible functions attract (green) and incompatible ones repel (red). Each magnet repaints the block nearest to it.</p>
          <div className="chips">
            {FUNCTIONS.map((f) => (
              <button key={f} className={f === placing ? 'chip active' : 'chip'} onClick={() => setPlacing(f)}>{FUNCTION_ICON[f]} {f}</button>
            ))}
          </div>
          <div className="row">
            <button disabled={!magnets.length} onClick={() => setMagnets((ms) => ms.slice(0, -1))}>Undo magnet</button>
            <button disabled={!magnets.length} onClick={() => setMagnets([])}>Clear</button>
          </div>
          <div className="row">
            <button onClick={() => setStage('density')}>← Density</button>
            <button disabled={gen.busy} onClick={() => renderNeighborhood(true)}>Regenerate render</button>
          </div>
          <button className="primary" disabled={gen.busy || !magnets.length} onClick={inpaint}>Inpaint functions →</button>
        </Step>
        <GenStatus busy={gen.busy} error={gen.error} label="model_1 is generating" />
      </aside>

      <section className="stage">
        {stage === 'zoning' && (
          <svg ref={zoningSvg} className="surface" viewBox={`0 0 ${SITE} ${SITE}`} onPointerDown={zoningDown} onPointerMove={zoningMove} onPointerUp={zoningUp} onPointerCancel={zoningUp}>
            <rect width={SITE} height={SITE} fill="#8f8f8f" />
            {livePlan.blocks.map((b) => (
              <rect key={`${b.i}-${b.j}`} x={b.i * CELL + STREET / 2} y={b.j * CELL + STREET / 2} width={CELL - STREET} height={CELL - STREET}
                fill={ZONE_COLOR[b.zone]} opacity={b.zone === 'none' ? 1 : 0.55} />
            ))}
            {bands.map((b) => (
              <g key={b.id}>
                <polygon points={b.points.map((p) => p.join(',')).join(' ')} fill={ZONE_COLOR[b.zone]} fillOpacity={0.15}
                  stroke={ZONE_COLOR[b.zone]} strokeWidth={b.id === selectedBand ? 5 : 3.5} strokeLinejoin="round" />
                {b.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="white" stroke={ZONE_COLOR[b.zone]} strokeWidth={2} />)}
              </g>
            ))}
            {activeStrokes.map((s, k) => <polyline key={k} points={s.map((p) => p.join(',')).join(' ')} fill="none" stroke={ZONE_COLOR[zone]} strokeWidth={3} strokeDasharray="6 4" />)}
          </svg>
        )}
        {stage === 'density' && (
          <div className="split">
            <div className="three" ref={viewHost} />
            <div className="clay-wrap">
              <div className="caption">Density clay (drag to sculpt)</div>
              <svg ref={claySvg} className="surface clay" viewBox={`0 0 ${DENSITY_RES} ${DENSITY_RES}`}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); clayPointers.current.add(e.pointerId); clayAt(e); }}
                onPointerMove={(e) => clayPointers.current.has(e.pointerId) && clayAt(e)}
                onPointerUp={(e) => clayPointers.current.delete(e.pointerId)} onPointerCancel={(e) => clayPointers.current.delete(e.pointerId)}>
                {plan?.blocks.map((b) => (
                  <rect key={`z${b.i}-${b.j}`} x={b.i * 2} y={b.j * 2} width={2} height={2} fill={ZONE_COLOR[b.zone]} />
                ))}
                {density?.map((row, y) => row.map((v, x) => (
                  <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#5a3b22" opacity={v * 0.85} />
                )))}
                {Array.from({ length: N_BLOCKS + 1 }, (_, i) => (
                  <g key={i}><line x1={i * 2} y1={0} x2={i * 2} y2={DENSITY_RES} stroke="#fff" strokeWidth={0.08} /><line y1={i * 2} x1={0} y2={i * 2} x2={DENSITY_RES} stroke="#fff" strokeWidth={0.08} /></g>
                ))}
              </svg>
            </div>
          </div>
        )}
        {stage === 'functions' && renders[current] && (
          <div className="render-wrap">
            <div className="layered" style={{ width: RENDER_SIZE, height: RENDER_SIZE }}>
              <SvgImage svg={renders[current].svg} size={RENDER_SIZE} alt="neighborhood render" />
              <svg ref={magnetSvg} className="overlay" viewBox={`0 0 ${RENDER_SIZE} ${RENDER_SIZE}`} onPointerDown={magnetDown} onPointerMove={magnetMove} onPointerUp={magnetUp} onPointerCancel={magnetUp}>
                {magnets.flatMap((a, i) => magnets.slice(i + 1).map((b) => {
                  const c = compatibility(a.fn, b.fn);
                  const d = Math.hypot(a.x - b.x, a.y - b.y);
                  if (c === 0 || d > 260) return null;
                  return <line key={a.id + b.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c > 0 ? '#2ecc71' : '#e74c3c'} strokeWidth={2} strokeDasharray={c > 0 ? undefined : '5 4'} opacity={0.8} />;
                }))}
                {lastMasks?.masks.map((m) => <rect key={m.id} x={m.x} y={m.y} width={m.w} height={m.h} fill="none" stroke="#fff" strokeDasharray="3 3" />)}
                {magnets.map((m) => {
                  const bi = Math.floor(m.x / cellR), bj = Math.floor(m.y / cellR);
                  return (
                    <g key={m.id}>
                      <rect x={bi * cellR + 3} y={bj * cellR + 3} width={cellR - 6} height={cellR - 6} fill="#fff" opacity={0.18} />
                      <circle cx={m.x} cy={m.y} r={18} fill="#ffffffee" stroke="#222" strokeWidth={2} />
                      <text x={m.x} y={m.y + 6} textAnchor="middle" fontSize={18}>{FUNCTION_ICON[m.fn]}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <VersionStrip versions={renders} current={current} onPick={setCurrent} />
          </div>
        )}
      </section>

      <aside className="panel right">
        <h3>Pipeline state</h3>
        <dl className="state">
          <dt>zoning_bands</dt><dd>{bands.length} band(s): {bands.map((b) => b.zone).join(', ') || '—'}</dd>
          <dt>urban_plan</dt><dd>{plan ? `${plan.blocks.filter((b) => b.zone !== 'none').length} zoned blocks` : '—'}</dd>
          <dt>city_model</dt><dd>{city ? `${city.buildings.length} template objects` : '—'}</dd>
        </dl>
        {depth && (<><h4>depth_map</h4><img className="thumb" src={depth.png} alt="depth map" /></>)}
        {lastMasks && (
          <>
            <h4>inpainting masks &amp; function prompts</h4>
            <ul className="small">{lastMasks.masks.map((m, i) => <li key={m.id}>[{m.x},{m.y} {m.w}×{m.h}] {lastMasks.prompts[i]}</li>)}</ul>
          </>
        )}
        {renders.length > 0 && stage !== 'functions' && (<><h4>latest render</h4><SvgImage svg={renders[current].svg} alt="render" /></>)}
      </aside>
    </div>
  );
}
