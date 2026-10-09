// Visual half of tool_2 execute (r16 view, r20 storybook) and the editor map of process 1.
import { isVisibleObject } from './engine.js';

export const TILE = 44;
export const KIND_COLORS = {
  indoor: '#e9dcc3',
  outdoor: '#cfe5b4',
  road: '#ddd6cc',
  water: '#b9daf0',
  forest: '#a9cf9a',
};
const BORDER = '#6b5a45';

/** Draw regions + labels. `regions` items: {id, kind, rect, name}. */
export function drawMap(ctx, regions, { tile = TILE, highlight = null } = {}) {
  ctx.save();
  for (const r of regions) {
    const { x, y, w, h } = r.rect;
    ctx.fillStyle = KIND_COLORS[r.kind] || '#eee';
    ctx.fillRect(x * tile, y * tile, w * tile, h * tile);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) ctx.strokeRect(i * tile, j * tile, tile, tile);
  }
  for (const r of regions) {
    const { x, y, w, h } = r.rect;
    ctx.lineWidth = r.id === highlight ? 4 : 2;
    ctx.strokeStyle = r.id === highlight ? '#c0392b' : BORDER;
    ctx.strokeRect(x * tile + 1, y * tile + 1, w * tile - 2, h * tile - 2);
    ctx.fillStyle = 'rgba(60,45,30,0.85)';
    ctx.font = `600 ${Math.round(tile * 0.3)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(r.name || r.hint || r.id, x * tile + 6, y * tile + 5, w * tile - 12);
  }
  ctx.restore();
}

export function drawToken(ctx, pos, { emoji = '❓', color = null, ring = false, faded = false, tile = TILE }) {
  const cx = pos.x * tile + tile / 2;
  const cy = pos.y * tile + tile / 2;
  ctx.save();
  if (faded) ctx.globalAlpha = 0.35;
  if (color) {
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.47, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c0392b';
    ctx.stroke();
  }
  ctx.font = `${Math.round(tile * 0.58)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, cx, cy + 1);
  ctx.restore();
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function bubble(ctx, pos, text, tile, W) {
  ctx.save();
  ctx.font = '14px system-ui, sans-serif';
  const lines = wrap(ctx, text, 260).slice(0, 6);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
  const height = lines.length * 18 + 14;
  let bx = pos.x * tile + tile / 2 - width / 2;
  bx = Math.max(4, Math.min(W - width - 4, bx));
  let by = pos.y * tile - height - 10;
  if (by < 4) by = pos.y * tile + tile + 10;
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 10, by + 8 + i * 18));
  ctx.restore();
}

function banner(ctx, text, W, H) {
  ctx.save();
  ctx.font = 'italic 15px Georgia, serif';
  const lines = wrap(ctx, text, W - 60).slice(0, 4);
  const height = lines.length * 20 + 18;
  ctx.fillStyle = 'rgba(30,24,18,0.86)';
  ctx.fillRect(0, H - height, W, height);
  ctx.fillStyle = '#f7efe1';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 30, H - height + 9 + i * 20));
  ctx.restore();
}

/**
 * r16 view = render(r14 gameSpec, r15 gameState, overlay).
 * overlay: null | {type:'speech', characterId, text} (process 5) | {type:'narration', text} (process 6)
 */
export function renderView(canvas, spec, state, overlay = null) {
  const ctx = canvas.getContext('2d');
  canvas.width = spec.map.cols * TILE;
  canvas.height = spec.map.rows * TILE;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMap(ctx, spec.map.regions);
  for (const o of spec.objects) {
    if (!isVisibleObject(state, o.id)) continue;
    drawToken(ctx, state.positions[o.id], { emoji: o.emoji });
  }
  for (const c of spec.characters) {
    drawToken(ctx, state.positions[c.id], { emoji: c.emoji, color: c.color, ring: c.id === spec.playerId });
  }
  if (overlay?.type === 'speech' && state.positions[overlay.characterId]) bubble(ctx, state.positions[overlay.characterId], overlay.text, TILE, canvas.width);
  if (overlay?.type === 'narration') banner(ctx, overlay.text, canvas.width, canvas.height);
  if (state.ended) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3a2d20';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('The End', canvas.width / 2, canvas.height / 2);
  }
}

/** r20 storybook = final tool_2 execute: the whole play-through as one illustrated page. */
export function renderStorybook(canvas, spec, state) {
  const W = 900;
  const mapTile = 22;
  const mapW = spec.map.cols * mapTile;
  const mapH = spec.map.rows * mapTile;
  const ctx = canvas.getContext('2d');
  ctx.font = '15px Georgia, serif';
  const entries = state.log.filter((e) => e.kind !== 'system' || e.turn > 0);
  const blocks = entries.map((e) => {
    const speaker = e.speaker ? spec.characters.find((c) => c.id === e.speaker)?.name : null;
    const text = e.kind === 'action' ? `▸ ${e.text}` : speaker ? `${speaker}: “${e.text}”` : e.text;
    return { e, lines: wrap(ctx, text, W - 80) };
  });
  const textH = blocks.reduce((s, b) => s + b.lines.length * 21 + 6, 0);
  canvas.width = W;
  canvas.height = 110 + mapH + 30 + textH + 40;
  ctx.fillStyle = '#fbf6ec';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#3a2d20';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(spec.title, W / 2, 50);
  ctx.font = 'italic 14px Georgia, serif';
  ctx.fillText(`${state.turn} turns · ${state.flags.length} story beats`, W / 2, 78);
  ctx.textAlign = 'left';
  ctx.save();
  ctx.translate((W - mapW) / 2, 100);
  drawMap(ctx, spec.map.regions, { tile: mapTile });
  for (const o of spec.objects) if (isVisibleObject(state, o.id)) drawToken(ctx, state.positions[o.id], { emoji: o.emoji, tile: mapTile });
  for (const c of spec.characters) drawToken(ctx, state.positions[c.id], { emoji: c.emoji, color: c.color, ring: c.id === spec.playerId, tile: mapTile });
  ctx.restore();
  let y = 100 + mapH + 30;
  for (const b of blocks) {
    ctx.font = b.e.kind === 'action' ? 'bold 15px system-ui, sans-serif' : b.e.kind === 'speech' ? 'italic 15px Georgia, serif' : '15px Georgia, serif';
    ctx.fillStyle = b.e.kind === 'action' ? '#8a4b2a' : '#2a2118';
    for (const l of b.lines) {
      ctx.fillText(l, 40, y + 15);
      y += 21;
    }
    y += 6;
  }
}
