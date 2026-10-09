import { useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectMask, VideoAsset } from '../../shared/types';
import { api } from '../api';
import { Status } from '../components/Status';
import { useTask, type ProjectStore } from '../state';
import { translateChart, type AnimatedChart, type Box } from '../video/chart';
import { sceneAt, VIDEO_FPS } from '../video/compose';
import { grabFrame, loadVideo } from '../video/frames';
import { polygonBounds, removeObject } from '../video/inpaint';
import { composeChart } from '../video/overlay';
import { ChartPreview } from './ChartView';

type Mode = 'full' | 'shape';
interface Keyframe { time: number; dataUrl: string; width: number; height: number }
interface FlowState {
  keyframe?: Keyframe; // keyframe_full_1 / keyframe_shape_1
  point?: { x: number; y: number }; // object_point_*
  mask?: ObjectMask; // object_mask_*
  cleaned?: VideoAsset; // cleaned_video_*
  cleanedFrame?: string;
  region?: Box; // chart_region_1 (shape only)
  result?: VideoAsset; // video_with_chart_1 / video_with_shape_1
}

/**
 * Process 6 (full) and process 7 (shape):
 * video_1 + animated_chart_1 -> [human select] keyframe -> [human select] point -> [model_3 extract] mask
 * -> [tool_5 modify] cleaned video -> ([human select] chart_region) -> [tool_6 compose]
 */
export function ComposeView({ store }: { store: ProjectStore }) {
  const { project: p, update } = store;
  const [mode, setMode] = useState<Mode>('full');
  const [flows, setFlows] = useState<Record<Mode, FlowState>>({ full: {}, shape: {} });
  const task = useTask();
  const playerRef = useRef<HTMLVideoElement>(null);
  const chart: AnimatedChart | null = useMemo(() => {
    if (!p?.chartType) return null;
    try { return translateChart(p.chartData, p.chartType); } catch { return null; }
  }, [p?.chartData, p?.chartType]);
  if (!p) return null;

  const current = p.versions.find((v) => v.id === p.currentVersionId) ?? p.versions.at(-1);
  const video = current?.video; // video_1
  const f = flows[mode];
  const setF = (patch: Partial<FlowState>) => setFlows((all) => ({ ...all, [mode]: { ...all[mode], ...patch } }));

  if (!video) return <div className="panel empty">Render a video on the Story tab first.</div>;

  const segment = f.keyframe ? (() => { const s = sceneAt(video.request, f.keyframe.time); return { start: s.start, end: s.end }; })() : null;

  /* [human select] keyframe */
  const pickKeyframe = async () => {
    const el = playerRef.current!;
    el.pause();
    const v = await loadVideo(video.url);
    const c = await grabFrame(v, el.currentTime);
    setFlows((all) => ({ ...all, [mode]: { keyframe: { time: el.currentTime, dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height } } }));
  };

  /* [human select] object point -> [model_3 extract] */
  const pickPoint = (pt: { x: number; y: number }) => {
    if (!f.keyframe) return;
    setF({ point: pt, mask: undefined, cleaned: undefined, cleanedFrame: undefined, region: undefined, result: undefined });
    task.run('Finding the object (model_3)…', async () => {
      const mask = await api.extractMask({ image: f.keyframe!.dataUrl, width: f.keyframe!.width, height: f.keyframe!.height, point: pt });
      setF({ point: pt, mask });
    });
  };

  /* [tool_5 modify] */
  const clean = () =>
    task.run('Removing object from video (tool_5)…', async (prog) => {
      const blob = await removeObject(video.url, f.mask!, segment!, VIDEO_FPS, (x) => prog(x));
      const up = await api.upload(blob);
      const cleaned: VideoAsset = {
        id: up.url.split('/').pop()!, url: up.url, mime: up.mime, kind: mode === 'full' ? 'cleaned_full' : 'cleaned_shape',
        request: video.request, createdAt: new Date().toISOString(), removedRegion: polygonBounds(f.mask!.polygon), segment: segment!,
        note: `removed ${f.mask!.objectName}`,
      };
      const frame = await grabFrame(await loadVideo(up.url), f.keyframe!.time);
      setF({ cleaned, cleanedFrame: frame.toDataURL('image/png'), result: undefined });
    });

  /* [tool_6 compose] */
  const compose = () =>
    task.run('Compositing chart into video (tool_6)…', async (prog) => {
      const cleaned = f.cleaned!;
      const box = mode === 'full' ? fitBox(cleaned.removedRegion!) : f.region!;
      const blob = await composeChart(cleaned.url, chart!, box, cleaned.segment!, VIDEO_FPS, (x) => prog(x));
      const up = await api.upload(blob);
      const result: VideoAsset = {
        id: up.url.split('/').pop()!, url: up.url, mime: up.mime, kind: mode === 'full' ? 'with_chart' : 'with_shape',
        request: video.request, createdAt: new Date().toISOString(), segment: cleaned.segment, note: `${p.chartType} chart ${mode === 'full' ? 'in place of' : 'in drawn region after removing'} ${f.mask?.objectName}`,
      };
      setF({ result });
      update({ composites: [...p.composites, result] });
    });

  return (
    <div className="compose">
      <div className="mode-bar">
        <div className="segmented">
          <button className={mode === 'full' ? 'active' : ''} onClick={() => setMode('full')}>Replace object with chart</button>
          <button className={mode === 'shape' ? 'active' : ''} onClick={() => setMode('shape')}>Place chart in a drawn region</button>
        </div>
        <span className="muted small">Using video version {current!.number}{chart ? ` · ${p.chartType} chart` : ''}</span>
      </div>
      <Status {...task} onDismiss={task.clearError} />
      <div className="compose-grid">
        <section className="panel">
          <h3><span className="step">1</span> Pick a keyframe</h3>
          <video ref={playerRef} className="player" src={video.url} controls playsInline />
          <button className="wide" onClick={pickKeyframe}>Use this frame</button>
          <h3>Animated chart</h3>
          {chart ? <ChartPreview data={p.chartData} type={p.chartType!} /> : <p className="error">Choose chart data and a chart type on the Chart tab first.</p>}
        </section>

        <section className="panel">
          <h3><span className="step">2</span> Click the object to remove</h3>
          {f.keyframe ? (
            <PointPicker image={f.keyframe.dataUrl} point={f.point} mask={f.mask} onPick={pickPoint} disabled={!!task.busy} />
          ) : <div className="player placeholder">No keyframe yet</div>}
          {f.mask && <p className="muted small">Found: <strong>{f.mask.objectName}</strong>. Click again to pick a different object. The removal applies to scene “{segment && sceneAt(video.request, f.keyframe!.time).scene.title}” ({segment?.start}s–{segment?.end}s).</p>}
          <button className="wide" disabled={!f.mask || !!task.busy} onClick={clean}>Remove object from video</button>
        </section>

        <section className="panel">
          <h3><span className="step">3</span> {mode === 'shape' ? 'Draw the chart region, then compose' : 'Compose the chart'}</h3>
          {f.cleaned ? (
            <>
              <video className="player" src={f.cleaned.url} controls playsInline />
              {mode === 'shape' && f.cleanedFrame && (
                <RegionPicker image={f.cleanedFrame} region={f.region} onChange={(region) => setF({ region, result: undefined })} />
              )}
              <button className="primary wide" disabled={!chart || !!task.busy || (mode === 'shape' && !f.region)} onClick={compose}>
                Compose chart into video
              </button>
            </>
          ) : <div className="player placeholder">Cleaned video appears here</div>}
          {f.result && (
            <div className="result">
              <h3>Result</h3>
              <video className="player" src={f.result.url} controls playsInline autoPlay />
              <a className="button small" href={f.result.url} download>Download</a>
            </div>
          )}
        </section>
      </div>
      {p.composites.length > 0 && (
        <section className="panel">
          <h3>Earlier composites</h3>
          <div className="ref-grid">
            {p.composites.map((c) => (
              <div key={c.id} className="ref-card"><video className="ref-thumb" src={c.url} controls preload="metadata" /><span className="muted small">{c.note}</span></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** The chart replaces the removed object: use its bounds, enlarged to a readable minimum size. */
export function fitBox(r: Box): Box {
  const w = Math.min(1, Math.max(r.w * 1.1, 0.32));
  const h = Math.min(1, Math.max(r.h * 1.1, 0.38));
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return { x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h };
}

function relPoint(e: React.MouseEvent, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
}

function PointPicker({ image, point, mask, onPick, disabled }: { image: string; point?: { x: number; y: number }; mask?: ObjectMask; onPick: (p: { x: number; y: number }) => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`picker ${disabled ? 'disabled' : ''}`} onClick={(e) => !disabled && onPick(relPoint(e, ref.current!))}>
      <img src={image} alt="keyframe" draggable={false} />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        {mask && <polygon points={mask.polygon.map((p) => p.join(',')).join(' ')} className="mask" />}
      </svg>
      {point && <span className="dot" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />}
    </div>
  );
}

function RegionPicker({ image, region, onChange }: { image: string; region?: Box; onChange: (b: Box) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => setDrag((d) => d && { ...d, b: relPoint(e as unknown as React.MouseEvent, ref.current!) });
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const b = { x: Math.min(d.a.x, d.b.x), y: Math.min(d.a.y, d.b.y), w: Math.abs(d.a.x - d.b.x), h: Math.abs(d.a.y - d.b.y) };
      if (b.w > 0.05 && b.h > 0.05) onChangeRef.current(b);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging]);
  const shown = drag ? { x: Math.min(drag.a.x, drag.b.x), y: Math.min(drag.a.y, drag.b.y), w: Math.abs(drag.a.x - drag.b.x), h: Math.abs(drag.a.y - drag.b.y) } : region;
  return (
    <>
      <p className="muted small">Drag on the frame to draw where the chart goes.</p>
      <div ref={ref} className="picker crosshair" onMouseDown={(e) => { e.preventDefault(); const pt = relPoint(e, ref.current!); setDrag({ a: pt, b: pt }); }}>
        <img src={image} alt="cleaned frame" draggable={false} />
        {shown && <span className="region" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }} />}
      </div>
    </>
  );
}
