/** Process 1 — zoning bands → city model → density → depth map → render → function magnets → inpainted render. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, svgDataUrl } from '../api';
import { canvasPoint, clamp, uid } from '../geom';
import { download, ErrorBox, Generating, Rep, Step } from '../components';
import {
  createSite, DENSITY_BLOCKS, SITE_SIZE, tool1CleanBands, tool1SettleMagnets, tool2ApplyDensity,
  tool2PlanToCityModel, tool3CityToDensity, tool3CityToDepthMap, tool3ComposePlan, tool3MagnetsToMasks,
} from './tools';
import {
  FUNCTIONS, FUNCTION_ICONS, ZONES, ZONE_COLORS, type CityModel, type DensityGrid, type DepthMap,
  type FunctionMagnet, type FunctionPrompt, type InpaintMask, type Render, type UrbanFunction, type UrbanPlan,
  type UrbanSite, type Zone, type ZoningBand,
} from './types';
import type { Point } from '../shared/api';

type Phase = 'bands' | 'density' | 'render' | 'inpaint';

export default function UrbanView() {
  const urban_site = useMemo<UrbanSite>(() => createSite(), []);
  const [phase, setPhase] = useState<Phase>('bands');

  // [human specify] zoning bands
  const [zoning_bands_1, setBands1] = useState<ZoningBand[]>([]);
  const [zone, setZone] = useState<Zone>('residential');
  const [bandWidth, setBandWidth] = useState(64);
  // tool outputs
  const [zoning_bands_2, setBands2] = useState<ZoningBand[] | null>(null);
  const [urban_plan_1, setPlan] = useState<UrbanPlan | null>(null);
  const [city_model_1, setCity1] = useState<CityModel | null>(null);
  const [density_grid_1, setDensity1] = useState<DensityGrid | null>(null);
  const [density_grid_2, setDensity2] = useState<DensityGrid | null>(null);
  const [city_model_2, setCity2] = useState<CityModel | null>(null);
  const [depth_map_1, setDepth] = useState<DepthMap | null>(null);
  // model_1 outputs — every generated render_1 is kept so the user can go back to an earlier one
  const [renderHistory, setRenderHistory] = useState<Render[]>([]);
  const [render_1, setRender1] = useState<Render | null>(null);
  const [function_magnets_1, setMagnets1] = useState<FunctionMagnet[]>([]);
  const [fn, setFn] = useState<UrbanFunction>('park');
  const [function_magnets_2, setMagnets2] = useState<FunctionMagnet[] | null>(null);
  const [inpainting_masks_1, setMasks] = useState<InpaintMask[] | null>(null);
  const [function_prompts_1, setPrompts] = useState<FunctionPrompt[] | null>(null);
  const [render_2, setRender2] = useState<Render | null>(null);
  const [compare, setCompare] = useState<'side' | 'before' | 'after'>('side');

  // live preview of what [tool_2 modify] will produce while the density is being painted
  const city2View = useMemo(
    () => city_model_2 ?? (phase === 'density' && city_model_1 && density_grid_2 ? tool2ApplyDensity(city_model_1, density_grid_2) : null),
    [city_model_2, phase, city_model_1, density_grid_2],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- tool chain after the bands are confirmed ----
  function confirmBands() {
    const b2 = tool1CleanBands(zoning_bands_1, urban_site); // [tool_1 modify]
    const plan = tool3ComposePlan(b2, urban_site); // [tool_3 compose]
    const c1 = tool2PlanToCityModel(plan); // [tool_2 translate]
    const d1 = tool3CityToDensity(c1); // [tool_3 translate]
    setBands2(b2); setPlan(plan); setCity1(c1); setDensity1(d1); setDensity2(d1);
    setCity2(null); setDepth(null); setRender1(null); setRenderHistory([]); resetInpaint();
    setPhase('density');
  }

  // ---- tool chain after density edits, then model_1 generate ----
  function applyDensity() {
    if (!city_model_1 || !density_grid_2) return;
    const c2 = tool2ApplyDensity(city_model_1, density_grid_2); // [tool_2 modify]
    const dm = tool3CityToDepthMap(c2); // [tool_3 translate]
    setCity2(c2); setDepth(dm); resetInpaint();
    setPhase('render');
    void generateRender(dm);
  }

  async function generateRender(dm = depth_map_1) {
    if (!dm) return;
    setBusy('model_1 is rendering the district from the depth map…'); setError(null);
    try {
      const { svg } = await api.generateRender({
        depth_map: { width: dm.width, height: dm.height, grid: dm.grid, levels: dm.levels, maxHeightM: dm.maxHeightM },
      });
      const r: Render = { version: renderHistory.length + 1, svg, width: dm.width, height: dm.height };
      setRender1(r);
      setRenderHistory((h) => [...h, r]);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  function resetInpaint() {
    setMagnets1([]); setMagnets2(null); setMasks(null); setPrompts(null); setRender2(null);
  }

  // ---- after magnets are confirmed: tool_1, tool_3, then model_1 modify ----
  async function confirmMagnets(source = function_magnets_1) {
    if (!render_1 || !source.length) return;
    const m2 = tool1SettleMagnets(source); // [tool_1 modify]
    const { masks, prompts } = tool3MagnetsToMasks(m2); // [tool_3 translate]
    setMagnets2(m2); setMasks(masks); setPrompts(prompts); setRender2(null);
    setPhase('inpaint');
    setBusy('model_1 is inpainting the masked areas…'); setError(null);
    try {
      const { svg } = await api.inpaintRender({
        render: { svg: render_1.svg, width: render_1.width, height: render_1.height },
        inpainting_masks: masks,
        function_prompts: prompts,
      });
      setRender2({ version: 2, svg, width: render_1.width, height: render_1.height });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="workspace">
      <section className="stage">
        {phase === 'bands' && (
          <>
            <h2>1 · Lay zoning bands on the site</h2>
            <p className="hint">Pick a zone and drag across the site to lay a band, as if placing a strip of coloured material on the table.</p>
            <div className="toolbar">
              {ZONES.map((z) => (
                <button key={z} className={`chip ${zone === z ? 'on' : ''}`} style={{ borderColor: ZONE_COLORS[z] }} onClick={() => setZone(z)}>
                  <span className="swatch" style={{ background: ZONE_COLORS[z] }} />{z}
                </button>
              ))}
              <label className="slider">width <input type="range" min={16} max={160} step={8} value={bandWidth} onChange={(e) => setBandWidth(+e.target.value)} /> {bandWidth}px</label>
            </div>
            <BandCanvas site={urban_site} bands={zoning_bands_1} onAdd={(pts) => setBands1((b) => [...b, { id: uid('band'), zone, width: bandWidth, points: pts }])} zone={zone} width={bandWidth} />
            <div className="actions">
              <button onClick={() => setBands1((b) => b.slice(0, -1))} disabled={!zoning_bands_1.length}>Undo</button>
              <button onClick={() => setBands1([])} disabled={!zoning_bands_1.length}>Clear</button>
              <button className="primary" disabled={!zoning_bands_1.length} onClick={confirmBands}>Build city model →</button>
            </div>
          </>
        )}

        {phase === 'density' && urban_plan_1 && city_model_1 && density_grid_2 && (
          <>
            <h2>2 · Adjust the density grid</h2>
            <p className="hint">Paint on the grid to raise (＋) or lower (−) density per block. The 3D model updates when you apply.</p>
            <div className="row">
              <DensityEditor plan={urban_plan_1} density={density_grid_2} onChange={setDensity2} />
              {city2View && <IsoCity model={city2View} width={420} />}
            </div>
            <div className="actions">
              <button onClick={() => setPhase('bands')}>← Back to bands</button>
              <button onClick={() => density_grid_1 && setDensity2(density_grid_1)}>Reset density</button>
              <button className="primary" onClick={applyDensity}>Apply density & render →</button>
            </div>
          </>
        )}

        {phase === 'render' && (
          <>
            <h2>3 · Place function magnets on the render</h2>
            <p className="hint">Pick a function and click on the render to drop a magnet. Drag to move; double-click to remove.</p>
            <div className="toolbar">
              {FUNCTIONS.map((f) => (
                <button key={f} className={`chip ${fn === f ? 'on' : ''}`} onClick={() => setFn(f)}>{FUNCTION_ICONS[f]} {f}</button>
              ))}
            </div>
            {busy && <Generating label={busy} />}
            <ErrorBox error={error} onRetry={() => generateRender()} />
            {render_1 && (
              <MagnetBoard render={render_1} magnets={function_magnets_1} onChange={setMagnets1} fn={fn} />
            )}
            {renderHistory.length > 1 && (
              <div className="history">
                {renderHistory.map((r) => (
                  <img key={r.version} src={svgDataUrl(r.svg)} className={r === render_1 ? 'on' : ''} title={`render_1 #${r.version}`} onClick={() => { setRender1(r); resetInpaint(); }} />
                ))}
              </div>
            )}
            <div className="actions">
              <button onClick={() => setPhase('density')} disabled={!!busy}>← Back to density</button>
              <button onClick={() => { resetInpaint(); void generateRender(); }} disabled={!!busy}>Regenerate render</button>
              <button className="primary" disabled={!render_1 || !function_magnets_1.length || !!busy} onClick={() => confirmMagnets()}>Inpaint functions →</button>
            </div>
          </>
        )}

        {phase === 'inpaint' && render_1 && (
          <>
            <h2>4 · Compare render_1 and render_2</h2>
            <div className="toolbar">
              {(['side', 'before', 'after'] as const).map((c) => (
                <button key={c} className={`chip ${compare === c ? 'on' : ''}`} onClick={() => setCompare(c)}>{c === 'side' ? 'side by side' : c}</button>
              ))}
            </div>
            {busy && <Generating label={busy} />}
            <ErrorBox error={error} onRetry={() => confirmMagnets()} />
            <div className="compare">
              {(compare !== 'after') && (
                <figure>
                  <div className="layered">
                    <img src={svgDataUrl(render_1.svg)} />
                    {inpainting_masks_1 && (
                      <svg viewBox={`0 0 ${render_1.width} ${render_1.height}`}>
                        {inpainting_masks_1.map((m) => <circle key={m.id} cx={m.cx} cy={m.cy} r={m.r} className="mask" />)}
                      </svg>
                    )}
                  </div>
                  <figcaption>render_1 + inpainting_masks_1</figcaption>
                </figure>
              )}
              {(compare !== 'before') && render_2 && (
                <figure>
                  <img src={svgDataUrl(render_2.svg)} />
                  <figcaption>render_2</figcaption>
                </figure>
              )}
            </div>
            <div className="actions">
              <button onClick={() => { setPhase('render'); setRender2(null); }} disabled={!!busy}>← Edit magnets</button>
              <button onClick={() => confirmMagnets()} disabled={!!busy}>Regenerate render_2</button>
              {render_2 && <button className="primary" onClick={() => download('render_2.svg', render_2.svg)}>Download render_2</button>}
            </div>
          </>
        )}
      </section>

      <aside className="pipeline">
        <h3>Process 1</h3>
        <Rep id="urban_site_1" role="artifact" medium="spatial" active={phase === 'bands'} />
        <Step actor="human" op="specify" done={!!zoning_bands_2} />
        <Rep id="zoning_bands_1" role="instruction" medium="spatial*">{zoning_bands_1.length} bands</Rep>
        <Step actor="tool_1" op="modify" done={!!zoning_bands_2} />
        <Rep id="zoning_bands_2" role="instruction" medium="spatial*">{zoning_bands_2 ? `${zoning_bands_2.length} cleaned bands` : '—'}</Rep>
        <Step actor="tool_3" op="compose" done={!!urban_plan_1} />
        <Rep id="urban_plan_1" role="artifact" medium="spatial">{urban_plan_1 && <PlanThumb plan={urban_plan_1} />}</Rep>
        <Step actor="tool_2" op="translate" done={!!city_model_1} />
        <Rep id="city_model_1" role="artifact" medium="spatial">{city_model_1 && <IsoCity model={city_model_1} width={220} />}</Rep>
        <Step actor="tool_3" op="translate" done={!!density_grid_1} />
        <Rep id="density_grid_1" role="instruction" medium="spatial">{density_grid_1 && <DensityThumb d={density_grid_1} />}</Rep>
        <Step actor="human" op="modify" done={!!city_model_2} />
        <Rep id="density_grid_2" role="instruction" medium="spatial" active={phase === 'density'}>{density_grid_2 && phase !== 'bands' && <DensityThumb d={density_grid_2} />}</Rep>
        <Step actor="tool_2" op="modify" done={!!city_model_2} />
        <Rep id="city_model_2" role="artifact" medium="spatial">
          {city2View && <IsoCity model={city2View} width={220} />}
          {!city_model_2 && city2View && <div className="muted small">live preview</div>}
        </Rep>
        <Step actor="tool_3" op="translate" done={!!depth_map_1} />
        <Rep id="depth_map_1" role="artifact" medium="visual">{depth_map_1 && <img className="thumb" src={depth_map_1.pngDataUrl} />}</Rep>
        <Step actor="model_1" op="generate" generative done={!!render_1} running={!!busy && phase === 'render'} />
        <Rep id="render_1" role="artifact" medium="visual" active={phase === 'render'}>{render_1 && <img className="thumb" src={svgDataUrl(render_1.svg)} />}</Rep>
        <Step actor="human" op="specify" done={!!function_magnets_2} />
        <Rep id="function_magnets_1" role="instruction" medium="spatial*">{function_magnets_1.map((m) => FUNCTION_ICONS[m.fn]).join(' ') || '—'}</Rep>
        <Step actor="tool_1" op="modify" done={!!function_magnets_2} />
        <Rep id="function_magnets_2" role="instruction" medium="spatial*">{function_magnets_2 ? `${function_magnets_2.length} settled` : '—'}</Rep>
        <Step actor="tool_3" op="translate" done={!!inpainting_masks_1} />
        <Rep id="inpainting_masks_1" role="selection" medium="spatial*">{inpainting_masks_1 ? `${inpainting_masks_1.length} circles` : '—'}</Rep>
        <Rep id="function_prompts_1" role="instruction" medium="language*">
          {function_prompts_1 && <ul className="small">{function_prompts_1.map((p) => <li key={p.maskId}>{p.text}</li>)}</ul>}
        </Rep>
        <Step actor="model_1" op="modify" generative done={!!render_2} running={!!busy && phase === 'inpaint'} />
        <Rep id="render_2" role="artifact" medium="visual" active={phase === 'inpaint'}>{render_2 && <img className="thumb" src={svgDataUrl(render_2.svg)} />}</Rep>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ views

function SiteBase({ site }: { site: UrbanSite }) {
  const cell = site.size / site.grid;
  return (
    <>
      <rect width={site.size} height={site.size} fill={ZONE_COLORS.empty} />
      {site.water.map((w, i) => w && (
        <rect key={i} x={(i % site.grid) * cell} y={Math.floor(i / site.grid) * cell} width={cell + 0.5} height={cell + 0.5} fill={ZONE_COLORS.water} />
      ))}
      {Array.from({ length: site.grid + 1 }, (_, i) => (
        <g key={i} stroke="#0000000d">
          <line x1={i * cell} y1={0} x2={i * cell} y2={site.size} />
          <line y1={i * cell} x1={0} y2={i * cell} x2={site.size} />
        </g>
      ))}
    </>
  );
}

function BandCanvas({ site, bands, onAdd, zone, width }: { site: UrbanSite; bands: ZoningBand[]; onAdd: (pts: Point[]) => void; zone: Zone; width: number }) {
  const [cur, setCur] = useState<Point[] | null>(null);
  const toPath = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg
      className="board"
      viewBox={`0 0 ${site.size} ${site.size}`}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setCur([canvasPoint(e, e.currentTarget, site.size, site.size)]); }}
      onPointerMove={(e) => cur && setCur([...cur, canvasPoint(e, e.currentTarget, site.size, site.size)])}
      onPointerUp={() => { if (cur && cur.length > 1) onAdd(cur); setCur(null); }}
    >
      <SiteBase site={site} />
      {bands.map((b) => (
        <path key={b.id} d={toPath(b.points)} stroke={ZONE_COLORS[b.zone]} strokeWidth={b.width} strokeOpacity={0.7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {cur && <path d={toPath(cur)} stroke={ZONE_COLORS[zone]} strokeWidth={width} strokeOpacity={0.45} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function PlanSvg({ plan }: { plan: UrbanPlan }) {
  const cell = plan.size / plan.grid;
  return (
    <>
      {plan.cells.map((u, i) => (
        <rect key={i} x={(i % plan.grid) * cell} y={Math.floor(i / plan.grid) * cell} width={cell + 0.5} height={cell + 0.5} fill={ZONE_COLORS[u]} />
      ))}
    </>
  );
}

function PlanThumb({ plan }: { plan: UrbanPlan }) {
  return <svg className="thumb" viewBox={`0 0 ${plan.size} ${plan.size}`}><PlanSvg plan={plan} /></svg>;
}

const heat = (v: number) => `hsla(${(1 - v) * 60}, 90%, 50%, ${v * 0.8})`;

function DensityThumb({ d }: { d: DensityGrid }) {
  return (
    <svg className="thumb" viewBox={`0 0 ${d.blocks} ${d.blocks}`}>
      {d.values.map((v, i) => <rect key={i} x={i % d.blocks} y={Math.floor(i / d.blocks)} width={1} height={1} fill={heat(v)} stroke="#fff" strokeWidth={0.03} />)}
    </svg>
  );
}

function DensityEditor({ plan, density, onChange }: { plan: UrbanPlan; density: DensityGrid; onChange: (d: DensityGrid) => void }) {
  const [mode, setMode] = useState<1 | -1>(1);
  const painting = useRef<{ last: number } | null>(null);
  const bs = plan.size / density.blocks;
  function paint(e: React.PointerEvent<SVGSVGElement>) {
    const p = canvasPoint(e, e.currentTarget, plan.size, plan.size);
    const k = Math.floor(clamp(p.y, 0, plan.size - 1) / bs) * density.blocks + Math.floor(clamp(p.x, 0, plan.size - 1) / bs);
    if (painting.current?.last === k) return;
    painting.current = { last: k };
    const values = density.values.slice();
    values[k] = clamp(Math.round((values[k] + mode * 0.1) * 100) / 100, 0, 1);
    onChange({ ...density, values });
  }
  return (
    <div className="density-wrap">
      <div className="toolbar">
        <button className={`chip ${mode === 1 ? 'on' : ''}`} onClick={() => setMode(1)}>＋ raise</button>
        <button className={`chip ${mode === -1 ? 'on' : ''}`} onClick={() => setMode(-1)}>− lower</button>
        <span className="muted small">{DENSITY_BLOCKS}×{DENSITY_BLOCKS} blocks · click or drag</span>
      </div>
      <svg
        className="board"
        viewBox={`0 0 ${plan.size} ${plan.size}`}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); painting.current = { last: -1 }; paint(e); }}
        onPointerMove={(e) => painting.current && paint(e)}
        onPointerUp={() => (painting.current = null)}
      >
        <PlanSvg plan={plan} />
        {density.values.map((v, i) => (
          <g key={i}>
            <rect x={(i % density.blocks) * bs} y={Math.floor(i / density.blocks) * bs} width={bs} height={bs} fill={heat(v)} stroke="#fff" strokeWidth={1} />
            <text x={(i % density.blocks) * bs + bs / 2} y={Math.floor(i / density.blocks) * bs + bs / 2 + 5} textAnchor="middle" className="density-label">{Math.round(v * 100)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Isometric view of a city model (boxes on a tiled ground). */
export function IsoCity({ model, width }: { model: CityModel; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const { grid, cells } = model.plan;
    const W = width * 2, H = width * 1.4;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    const tw = W / grid, th = tw / 2, hs = th / 8; // height scale px per metre
    const ox = W / 2, oy = H * 0.3;
    const iso = (c: number, r: number, z = 0) => ({ x: ox + (c - r) * (tw / 2), y: oy + (c + r) * (th / 2) - z * hs });
    const poly = (pts: { x: number; y: number }[], fill: string) => {
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    };
    for (let r = 0; r < grid; r++)
      for (let c = 0; c < grid; c++) {
        const u = cells[r * grid + c];
        poly([iso(c, r), iso(c + 1, r), iso(c + 1, r + 1), iso(c, r + 1)], u === 'road' ? '#cfcfcf' : u === 'water' ? ZONE_COLORS.water : u === 'green' ? ZONE_COLORS.green : '#ece7dc');
      }
    const sorted = [...model.buildings].sort((a, b) => a.row + a.col - (b.row + b.col));
    for (const b of sorted) {
      const inset = (1 - b.footprint) / 2;
      const c0 = b.col + inset, c1 = b.col + 1 - inset, r0 = b.row + inset, r1 = b.row + 1 - inset;
      const z = b.height;
      const col = ZONE_COLORS[b.zone];
      poly([iso(c0, r1), iso(c1, r1), iso(c1, r1, z), iso(c0, r1, z)], shade(col, -0.25));
      poly([iso(c1, r0), iso(c1, r1), iso(c1, r1, z), iso(c1, r0, z)], shade(col, -0.4));
      poly([iso(c0, r0, z), iso(c1, r0, z), iso(c1, r1, z), iso(c0, r1, z)], col);
    }
  }, [model, width]);
  return <canvas ref={ref} style={{ width, height: width * 0.7 }} className="iso" />;
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => clamp(Math.round(((n >> s) & 255) * (1 + f)), 0, 255);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function MagnetBoard({ render, magnets, onChange, fn }: { render: Render; magnets: FunctionMagnet[]; onChange: (m: FunctionMagnet[]) => void; fn: UrbanFunction }) {
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  return (
    <div className="layered board-wrap">
      <img src={svgDataUrl(render.svg)} draggable={false} />
      <svg
        viewBox={`0 0 ${SITE_SIZE} ${SITE_SIZE}`}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const p = canvasPoint(e, e.currentTarget, SITE_SIZE, SITE_SIZE);
          onChange([...magnets, { id: uid('m'), fn, x: p.x, y: p.y, r: 40 }]);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = canvasPoint(e, e.currentTarget, SITE_SIZE, SITE_SIZE);
          drag.current.moved = true;
          onChange(magnets.map((m) => (m.id === drag.current!.id ? { ...m, x: p.x, y: p.y } : m)));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {magnets.map((m) => (
          <g key={m.id} className="magnet"
            onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget.ownerSVGElement as Element).setPointerCapture(e.pointerId); drag.current = { id: m.id, moved: false }; }}
            onDoubleClick={() => onChange(magnets.filter((x) => x.id !== m.id))}
          >
            <circle cx={m.x} cy={m.y} r={22} />
            <text x={m.x} y={m.y + 8} textAnchor="middle" fontSize={22}>{FUNCTION_ICONS[m.fn]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
