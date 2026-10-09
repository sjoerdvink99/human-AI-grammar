/** Process 2 — place ikebana elements → tidy → scribble map + prompt → generated image. */
import { useMemo, useState } from 'react';
import { api, svgDataUrl } from '../api';
import { canvasPoint, dist, uid } from '../geom';
import { download, ErrorBox, Generating, Rep, Step } from '../components';
import { createIkebanaCanvas, tool1TidyElements, tool3ElementsToScribble } from './tools';
import { ELEMENT_KINDS, type ElementKind, type GeneratedImage, type IkebanaCanvas, type IkebanaElement, type ScribbleMap } from './types';
import type { Point } from '../shared/api';

const KIND_STYLE: Record<ElementKind, { color: string; icon: string; width: number }> = {
  branch: { color: '#6b4a2b', icon: '🪵', width: 6 },
  flower: { color: '#d94f70', icon: '🌸', width: 3 },
  leaf: { color: '#3f8f4a', icon: '🍃', width: 4 },
  grass: { color: '#7aa33c', icon: '🌾', width: 2 },
};

export default function IkebanaView() {
  const ikebana_canvas = useMemo<IkebanaCanvas>(() => createIkebanaCanvas(), []);
  const [kind, setKind] = useState<ElementKind>('branch');
  const [ikebana_elements_1, setEl1] = useState<IkebanaElement[]>([]);
  const [ikebana_elements_2, setEl2] = useState<IkebanaElement[] | null>(null);
  const [scribble_map_1, setScribble] = useState<ScribbleMap | null>(null);
  const [ikebana_prompt_1, setPrompt] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [ikebana_image_1, setImage] = useState<GeneratedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function arrange() {
    const e2 = tool1TidyElements(ikebana_elements_1, ikebana_canvas); // [tool_1 modify]
    const { scribble, prompt } = tool3ElementsToScribble(e2, ikebana_canvas); // [tool_3 translate]
    setEl2(e2); setScribble(scribble); setPrompt(prompt);
    void generate(scribble, prompt);
  }

  async function generate(s = scribble_map_1, p = ikebana_prompt_1) {
    if (!s || !p) return;
    setBusy(true); setError(null);
    try {
      const { svg } = await api.generateIkebana({
        scribble_map: { width: s.width, height: s.height, strokes: s.strokes },
        ikebana_prompt: p,
      });
      const img = { version: images.length + 1, svg };
      setImages((h) => [...h, img]);
      setImage(img);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shown = ikebana_elements_2 ?? ikebana_elements_1;

  return (
    <div className="workspace">
      <section className="stage">
        <h2>Arrange the ikebana</h2>
        <p className="hint">Pick an element and drag on the canvas: branches, leaves and grass follow your stroke; for a flower, drag outward from its centre to set its size. Start stems near the vase mouth.</p>
        <div className="toolbar">
          {ELEMENT_KINDS.map((k) => (
            <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)} disabled={!!ikebana_elements_2}>
              {KIND_STYLE[k].icon} {k}
            </button>
          ))}
        </div>
        <div className="row">
          <figure>
            <ElementCanvas canvas={ikebana_canvas} elements={shown} locked={!!ikebana_elements_2} kind={kind} onAdd={(e) => setEl1((x) => [...x, e])} />
            <figcaption>{ikebana_elements_2 ? 'ikebana_elements_2 (tidied by tool_1)' : 'ikebana_elements_1'}</figcaption>
          </figure>
          {(ikebana_image_1 || busy || error) && (
            <figure>
              {busy && <Generating label="model_1 is generating the arrangement…" />}
              <ErrorBox error={error} onRetry={() => generate()} />
              {ikebana_image_1 && !busy && <img className="board" src={svgDataUrl(ikebana_image_1.svg)} />}
              <figcaption>ikebana_image_1 {ikebana_image_1 && `· variant ${ikebana_image_1.version}`}</figcaption>
            </figure>
          )}
        </div>
        {images.length > 1 && (
          <div className="history">
            {images.map((im) => <img key={im.version} src={svgDataUrl(im.svg)} className={im === ikebana_image_1 ? 'on' : ''} onClick={() => setImage(im)} />)}
          </div>
        )}
        <div className="actions">
          {!ikebana_elements_2 ? (
            <>
              <button onClick={() => setEl1((x) => x.slice(0, -1))} disabled={!ikebana_elements_1.length}>Undo</button>
              <button onClick={() => setEl1([])} disabled={!ikebana_elements_1.length}>Clear</button>
              <button className="primary" onClick={arrange} disabled={!ikebana_elements_1.length}>Generate arrangement →</button>
            </>
          ) : (
            <>
              <button onClick={() => { setEl2(null); setScribble(null); setPrompt(null); }} disabled={busy}>← Edit elements</button>
              <button onClick={() => generate()} disabled={busy}>Generate another variant</button>
              {ikebana_image_1 && <button className="primary" onClick={() => download('ikebana_image.svg', ikebana_image_1.svg)}>Download</button>}
            </>
          )}
        </div>
      </section>

      <aside className="pipeline">
        <h3>Process 2</h3>
        <Rep id="ikebana_canvas_1" role="artifact" medium="spatial" />
        <Step actor="human" op="specify" done={ikebana_elements_1.length > 0} />
        <Rep id="ikebana_elements_1" role="instruction" medium="spatial*" active={!ikebana_elements_2}>
          {ikebana_elements_1.map((e) => KIND_STYLE[e.kind].icon).join(' ') || '—'}
        </Rep>
        <Step actor="tool_1" op="modify" done={!!ikebana_elements_2} />
        <Rep id="ikebana_elements_2" role="instruction" medium="spatial*">{ikebana_elements_2 ? `${ikebana_elements_2.length} tidied` : '—'}</Rep>
        <Step actor="tool_3" op="translate" done={!!scribble_map_1} />
        <Rep id="scribble_map_1" role="artifact" medium="visual">{scribble_map_1 && <img className="thumb" src={scribble_map_1.pngDataUrl} />}</Rep>
        <Rep id="ikebana_prompt_1" role="instruction" medium="language">{ikebana_prompt_1 && <p className="small">{ikebana_prompt_1}</p>}</Rep>
        <Step actor="model_1" op="generate" generative done={!!ikebana_image_1} running={busy} />
        <Rep id="ikebana_image_1" role="artifact" medium="visual" active={!!ikebana_image_1}>{ikebana_image_1 && <img className="thumb" src={svgDataUrl(ikebana_image_1.svg)} />}</Rep>
      </aside>
    </div>
  );
}

function ElementCanvas({ canvas, elements, kind, onAdd, locked }: { canvas: IkebanaCanvas; elements: IkebanaElement[]; kind: ElementKind; onAdd: (e: IkebanaElement) => void; locked: boolean }) {
  const [cur, setCur] = useState<Point[] | null>(null);
  const { width: W, height: H } = canvas;
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const draw = (e: IkebanaElement | { kind: ElementKind; points: Point[]; size: number }, key: string, ghost = false) => {
    const st = KIND_STYLE[e.kind];
    if (e.kind === 'flower') {
      const r = e.size || (e.points.length > 1 ? dist(e.points[0], e.points[e.points.length - 1]) : 10);
      return <circle key={key} cx={e.points[0].x} cy={e.points[0].y} r={r} fill={st.color} fillOpacity={ghost ? 0.3 : 0.6} stroke={st.color} strokeWidth={2} />;
    }
    return <path key={key} d={path(e.points)} stroke={st.color} strokeWidth={st.width} strokeOpacity={ghost ? 0.5 : 1} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  };
  return (
    <svg
      className="board ikebana"
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={(e) => { if (locked) return; (e.target as Element).setPointerCapture?.(e.pointerId); setCur([canvasPoint(e, e.currentTarget, W, H)]); }}
      onPointerMove={(e) => cur && setCur([...cur, canvasPoint(e, e.currentTarget, W, H)])}
      onPointerUp={() => {
        if (cur) {
          if (kind === 'flower') onAdd({ id: uid('f'), kind, points: [cur[0]], size: Math.max(10, dist(cur[0], cur[cur.length - 1])) });
          else if (cur.length > 2) onAdd({ id: uid('e'), kind, points: cur, size: 0 });
        }
        setCur(null);
      }}
    >
      <rect width={W} height={H} fill="#faf6ee" />
      <polygon points={canvas.vase.map((p) => `${p.x},${p.y}`).join(' ')} fill="#8a8178" />
      <ellipse cx={canvas.mouth.x} cy={canvas.mouth.y} rx={50} ry={6} fill="#5b544d" />
      {elements.map((e) => draw(e, e.id))}
      {cur && draw({ kind, points: cur, size: 0 }, 'cur', true)}
    </svg>
  );
}
