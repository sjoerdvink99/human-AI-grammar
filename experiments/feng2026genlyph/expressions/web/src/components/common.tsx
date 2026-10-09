import { useMemo } from 'react';
import type { Keyword, CandidateRound } from '../types';
import { actions, useStore } from '../store';

export function Svg({ svg, size, className, title }: { svg: string; size?: number; className?: string; title?: string }) {
  return (
    <div className={`svgbox ${className || ''}`} title={title} style={size ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner-wrap"><span className="spinner" />{label}</span>;
}

/** (word_cloud_1: artifact visual) — [tool_1 translate] keywords_1* -> word_cloud_1 */
export function WordCloud({ keywords, width = 460, height = 220 }: { keywords: Keyword[]; width?: number; height?: number }) {
  const placed = useMemo(() => {
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const out: { k: Keyword; x: number; y: number; size: number; color: string }[] = [];
    const palette = ['#1f5f8b', '#c0392b', '#2e7d32', '#8e44ad', '#d35400', '#16a085'];
    keywords.forEach((k, i) => {
      const size = 11 + k.weight * 2.4;
      const w = k.text.length * size * 0.55, h = size;
      for (let t = 0; t < 600; t++) {
        const a = t * 0.35, r = t * 0.9;
        const x = width / 2 + r * Math.cos(a) * 1.6 - w / 2, y = height / 2 + r * Math.sin(a) - h / 2;
        if (x < 2 || y < 2 || x + w > width - 2 || y + h > height - 2) continue;
        if (boxes.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y)) continue;
        boxes.push({ x, y, w, h });
        out.push({ k, x, y: y + h * 0.82, size, color: palette[i % palette.length] });
        break;
      }
    });
    return out;
  }, [keywords, width, height]);
  return (
    <svg className="wordcloud" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {placed.map(({ k, x, y, size, color }) => (
        <text key={k.text} x={x} y={y} fontSize={size} fill={color} opacity={k.active ? 1 : 0.2}
          style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => actions.toggleKeyword(k.text)}>
          <title>{`${k.text} (weight ${k.weight}) — click to toggle`}</title>
          {k.text}
        </text>
      ))}
    </svg>
  );
}

/** (candidate_images_n: artifact visual)* gallery; clicking an image is [human select] -> glyph_image_1 */
export function CandidateGallery() {
  const rounds = useStore((s) => s.candidateRounds);
  const selected = useStore((s) => s.glyphSource);
  if (!rounds.length) return <p className="muted">No candidate images yet.</p>;
  return (
    <div className="rounds">
      {rounds.map((r, ri) => (
        <div key={r.id} className="round">
          <div className="round-head">
            Round {rounds.length - ri} · {r.source === 'keywords' ? 'from keywords' : <>concept: <em>“{r.conceptPrompt}”</em></>}
          </div>
          <div className="gallery">
            {r.images.map((img, i) => <CandidateCell key={i} round={r} i={i} img={img} selected={selected} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function CandidateCell({ round, i, img, selected }: { round: CandidateRound; i: number; img: CandidateRound['images'][number]; selected: string | null }) {
  if ('pending' in img) return <div className="cell pending"><Spinner label="drawing…" /></div>;
  if ('error' in img)
    return (
      <div className="cell err" title={round.prompts[i]}>
        <small>{img.error}</small>
        <button onClick={() => actions.retryImage(round.id, i)}>Retry</button>
      </div>
    );
  const isSel = selected === img.svg;
  return (
    <div className={`cell ${isSel ? 'sel' : ''}`} title={round.prompts[i]}>
      <Svg svg={img.svg} size={150} />
      <button className="primary small" onClick={() => actions.selectGlyphImage(img.svg)}>Use as glyph</button>
    </div>
  );
}
