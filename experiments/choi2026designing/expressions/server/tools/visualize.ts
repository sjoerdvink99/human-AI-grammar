/** tool_5 translate: song + timed_lyrics + audio_features + beat_features → music_visualization (SVG). */
import type { AudioFeatures, BeatRow, TimedLyrics } from '../types.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PALETTE = ['#6c8ebf', '#d79b00', '#82b366', '#b85450', '#9673a6', '#3c8d93'];

export function renderVisualization(timed: TimedLyrics, features: AudioFeatures, beats: BeatRow[]): string {
  const W = 1000, H = 240, pad = 10;
  const dur = Math.max(1, features.duration);
  const x = (t: number) => pad + (t / dur) * (W - 2 * pad);
  const curve = features.energy_curve;
  const waveTop = 20, waveH = 110;
  const pts = curve.map((v, i) => `${x((i / (curve.length - 1)) * dur).toFixed(1)},${(waveTop + waveH / 2 - (v * waveH) / 2).toFixed(1)}`);
  const ptsBottom = curve.map((v, i) => `${x((i / (curve.length - 1)) * dur).toFixed(1)},${(waveTop + waveH / 2 + (v * waveH) / 2).toFixed(1)}`).reverse();
  const sections = [...new Set(timed.lines.map((l) => l.section))];
  const color = (s: string) => PALETTE[sections.indexOf(s) % PALETTE.length];

  const beatMarks = beats
    .map((b) => `<line x1="${x(b.time).toFixed(1)}" x2="${x(b.time).toFixed(1)}" y1="${b.downbeat ? 140 : 146}" y2="156" stroke="#555" stroke-opacity="${(0.25 + 0.75 * b.strength).toFixed(2)}" stroke-width="${b.downbeat ? 1.5 : 0.7}"/>`)
    .join('');
  const lyricBars = timed.lines
    .filter((l) => l.start !== null && l.end !== null)
    .map((l, i) => {
      const x0 = x(l.start!), x1 = x(l.end!);
      const y = 166 + (i % 2) * 30;
      return `<g><rect x="${x0.toFixed(1)}" y="${y}" width="${Math.max(2, x1 - x0).toFixed(1)}" height="24" rx="4" fill="${color(l.section)}" fill-opacity="0.85"/><title>${esc(l.section)}: ${esc(l.line)}</title>` +
        `<text x="${(x0 + 4).toFixed(1)}" y="${y + 16}" font-size="10" fill="#fff">${esc(l.line.length > 28 ? l.line.slice(0, 27) + '…' : l.line)}</text></g>`;
    })
    .join('');
  const legend = sections
    .map((s, i) => `<rect x="${pad + i * 110}" y="2" width="10" height="10" fill="${color(s)}"/><text x="${pad + 14 + i * 110}" y="11" font-size="10" fill="#333">${esc(s || 'Lyrics')}</text>`)
    .join('');
  const ticks = Array.from({ length: Math.floor(dur / 15) + 1 }, (_, k) => k * 15)
    .map((t) => `<text x="${x(t).toFixed(1)}" y="236" font-size="9" fill="#777">${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" font-family="system-ui, sans-serif">` +
    `<rect width="${W}" height="${H}" fill="#fbfaf7"/>${legend}` +
    `<polygon points="${pts.concat(ptsBottom).join(' ')}" fill="#c9b8e8" stroke="#7e64b3" stroke-width="0.6"/>` +
    beatMarks + lyricBars + ticks + `</svg>`;
}
