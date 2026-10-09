// Process 2 — Ikebana flower arrangement.
import { useMemo, useRef, useState } from 'react';
import { ikebanaCanvas1, KIND_COLOR, KIND_LABEL, KIND_RADIUS, type IkebanaElement, type IkebanaKind } from './types';
import { enforceIkebana } from '../tools/physics';
import { scribbleToSvg, toIkebanaPrompt, toScribble } from '../tools/ikebanaPre';
import { uid } from '../tools/geometry';
import { GenStatus, SvgImage, VersionStrip, post, useGen } from '../shared/ui';
import type { SvgRes } from '../shared/api';

const C = ikebanaCanvas1;

function initial(): IkebanaElement[] {
  const [ox, oy] = C.origin;
  const at = (kind: IkebanaKind, len: number, deg: number): IkebanaElement => {
    const r = (deg * Math.PI) / 180;
    return { id: kind, kind, r: KIND_RADIUS[kind], x: ox + Math.sin(r) * len, y: oy - Math.cos(r) * len };
  };
  return enforceIkebana([at('shin', 300, 12), at('soe', 225, -45), at('hikae', 170, 72)], C.origin, C.size);
}

export function IkebanaProbe() {
  // ikebana_elements (human specify → tool_1 modify)
  const [elements, setElements] = useState<IkebanaElement[]>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const drags = useRef(new Map<number, string>());
  const [images, setImages] = useState<{ label: string; svg: string }[]>([]);
  const [current, setCurrent] = useState(0);
  const gen = useGen();

  // ikebana_elements_2 -> [tool_3 translate] -> scribble_map_1 + ikebana_prompt_1
  const scribble = useMemo(() => toScribble(elements, C), [elements]);
  const prompt = useMemo(() => toIkebanaPrompt(elements), [elements]);

  const local = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const pt = e.currentTarget.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(e.currentTarget.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };
  function down(e: React.PointerEvent<SVGSVGElement>) {
    const p = local(e);
    const hit = [...elements].reverse().find((el) => Math.hypot(el.x - p[0], el.y - p[1]) < el.r + 6);
    if (!hit) { setSelected(null); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    drags.current.set(e.pointerId, hit.id);
    setSelected(hit.id);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const id = drags.current.get(e.pointerId);
    if (!id) return;
    const pos = local(e); // read the pointer before the (deferred) state update
    setElements((els) => enforceIkebana(els, C.origin, C.size, { id, pos }));
  }
  function up(e: React.PointerEvent<SVGSVGElement>) {
    if (drags.current.delete(e.pointerId)) setElements((els) => enforceIkebana(els, C.origin, C.size));
  }
  function add(kind: 'flower' | 'leaf') {
    const [ox, oy] = C.origin;
    const deg = (Math.random() * 2 - 1) * 60;
    const len = 90 + Math.random() * 100;
    const r = (deg * Math.PI) / 180;
    const el: IkebanaElement = { id: uid(kind), kind, r: KIND_RADIUS[kind], x: ox + Math.sin(r) * len, y: oy - Math.cos(r) * len };
    setElements((els) => enforceIkebana([...els, el], C.origin, C.size));
    setSelected(el.id);
  }

  // scribble_map_1 + ikebana_prompt_1 -> [model_1 generate]~ -> ikebana_image_1
  async function generate() {
    const res = await gen.run(() => post<SvgRes>('/api/ikebana/generate', { scribble, prompt }));
    if (!res) return;
    setImages((im) => {
      const next = [...im, { label: `#${im.length + 1}`, svg: res.svg }];
      setCurrent(next.length - 1);
      return next;
    });
  }

  const sel = elements.find((e) => e.id === selected);
  const { vase, origin } = C;
  return (
    <div className="probe">
      <aside className="panel">
        <h2>Ikebana</h2>
        <p>Drag the magnetic circles. The three main stems keep the classical proportions <b>shin : soe : hikae = 1 : ¾ : 9⁄16</b> and their angle ranges. Dragging any main stem rescales the whole arrangement. Flowers and leaves snap toward the nearest stem and push each other away.</p>
        <div className="row">
          <button onClick={() => add('flower')}>+ Flower</button>
          <button onClick={() => add('leaf')}>+ Leaf</button>
        </div>
        <div className="row">
          <button disabled={!sel || ['shin', 'soe', 'hikae'].includes(sel.kind)} onClick={() => { setElements((els) => els.filter((e) => e.id !== selected)); setSelected(null); }}>Remove selected</button>
          <button onClick={() => { setElements(initial()); setSelected(null); }}>Reset</button>
        </div>
        <ul className="legend">
          {(['shin', 'soe', 'hikae', 'flower', 'leaf'] as IkebanaKind[]).map((k) => (
            <li key={k}><span className="dot" style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]}</li>
          ))}
        </ul>
        <button className="primary" disabled={gen.busy} onClick={generate}>{images.length ? 'Generate again' : 'Generate arrangement →'}</button>
        <GenStatus busy={gen.busy} error={gen.error} label="model_1 is generating" />
      </aside>

      <section className="stage">
        <svg className="surface" viewBox={`0 0 ${C.size} ${C.size}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <rect width={C.size} height={C.size} fill="#f7f3ea" />
          {/* proportion guides */}
          {(['shin', 'soe', 'hikae'] as const).map((k) => {
            const e = elements.find((x) => x.kind === k);
            if (!e) return null;
            return <circle key={k} cx={origin[0]} cy={origin[1]} r={Math.hypot(e.x - origin[0], e.y - origin[1])} fill="none" stroke={KIND_COLOR[k]} strokeOpacity={0.18} strokeDasharray="4 6" />;
          })}
          {scribble.strokes.slice(1).map((s, i) => (
            <polyline key={i} points={s.points.map((p) => p.join(',')).join(' ')} fill="none" stroke="#6b5b3e" strokeWidth={2.5} strokeLinecap="round" />
          ))}
          <path d={`M${vase.x},${vase.y} L${vase.x + 12},${vase.y + vase.h} L${vase.x + vase.w - 12},${vase.y + vase.h} L${vase.x + vase.w},${vase.y} Z`} fill="#3d4a5c" />
          {elements.map((e) => (
            <g key={e.id} style={{ cursor: 'grab' }}>
              <circle cx={e.x} cy={e.y} r={e.r} fill={KIND_COLOR[e.kind]} fillOpacity={0.85} stroke={e.id === selected ? '#111' : '#fff'} strokeWidth={3} />
              <circle cx={e.x} cy={e.y} r={e.r + 8} fill="none" stroke={KIND_COLOR[e.kind]} strokeOpacity={0.3} strokeWidth={2} />
              {['shin', 'soe', 'hikae'].includes(e.kind) && <text x={e.x} y={e.y + 4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700}>{e.kind}</text>}
            </g>
          ))}
        </svg>
      </section>

      <aside className="panel right">
        <h4>scribble_map</h4>
        <SvgImage svg={scribbleToSvg(scribble)} alt="scribble map" />
        <h4>ikebana_prompt</h4>
        <p className="small prompt">{prompt}</p>
        {images[current] && (
          <>
            <h4>ikebana_image</h4>
            <SvgImage svg={images[current].svg} alt="generated arrangement" />
            <VersionStrip versions={images} current={current} onPick={setCurrent} />
          </>
        )}
      </aside>
    </div>
  );
}
