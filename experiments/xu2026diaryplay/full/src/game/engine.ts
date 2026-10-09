/**
 * tool_2 — a small HTML5 canvas game framework: renders scene (scene_1..3), moves characters
 * along tool_1 paths, and shows activity labels, speech bubbles and the inner-voice cue.
 */
import { approachTiles, blockedTiles, findPath, isWalkable } from '../../shared/tool1';
import type { Environment, PlannedActivity, Point, Vignette } from '../../shared/types';

export const TILE = 36;
const SPEED = 5; // tiles per second

interface Actor {
  id: string; name: string; color: string; isPlayer: boolean;
  tile: Point; draw: { x: number; y: number }; path: Point[];
  label: string; bubble: { text: string; until: number } | null;
  onArrive: (() => void) | null;
}

const ROOM_COLORS = ['#f4ead5', '#e3efe6', '#e6ebf5', '#f5e6e8', '#efe9f7', '#f7f1df'];

export class Engine {
  private ctx: CanvasRenderingContext2D;
  private actors = new Map<string, Actor>();
  private env: Environment;
  private raf = 0;
  private last = 0;
  private voice: { text: string; until: number } | null = null;
  highlight: string | null = null;

  constructor(private canvas: HTMLCanvasElement, v: Vignette) {
    this.env = v.environment;
    canvas.width = this.env.width * TILE;
    canvas.height = this.env.height * TILE;
    this.ctx = canvas.getContext('2d')!;
    for (const c of v.characters) {
      const p = v.startPositions[c.id] ?? { x: 1, y: 1 };
      this.actors.set(c.id, { id: c.id, name: c.name, color: c.color, isPlayer: c.isPlayer, tile: { ...p }, draw: { ...p }, path: [], label: '', bubble: null, onArrive: null });
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() { cancelAnimationFrame(this.raf); }

  positions(): Record<string, Point> {
    const out: Record<string, Point> = {};
    for (const a of this.actors.values()) out[a.id] = { ...a.tile };
    return out;
  }

  tileOf(id: string) { return this.actors.get(id)?.tile; }

  /** Player one-step move (arrow keys). */
  step(id: string, dx: number, dy: number) {
    const a = this.actors.get(id);
    if (!a || a.path.length) return;
    const n = { x: a.tile.x + dx, y: a.tile.y + dy };
    if (isWalkable(this.env, n) && ![...this.actors.values()].some((o) => o !== a && o.tile.x === n.x && o.tile.y === n.y)) a.path = [n];
  }

  /** Walk along a tool_1 path; resolves on arrival. */
  walkTo(id: string, goals: Point[]): Promise<boolean> {
    const a = this.actors.get(id);
    if (!a) return Promise.resolve(false);
    const path = findPath(this.env, a.tile, goals, blockedTiles(this.env.objects));
    if (!path) return Promise.resolve(false);
    a.path = path.slice(1);
    if (a.onArrive) { const f = a.onArrive; a.onArrive = null; f(); }
    return new Promise((res) => { if (!a.path.length) res(true); else a.onArrive = () => res(true); });
  }

  walkToObject(id: string, objectId: string) {
    const o = this.env.objects.find((x) => x.id === objectId);
    return o ? this.walkTo(id, approachTiles(this.env, o)) : Promise.resolve(false);
  }

  /** P4.5 — perform one npc_activity: walk to its object, show the activity and any line. */
  async perform(act: PlannedActivity) {
    if (act.objectId) await this.walkToObject(act.characterId, act.objectId);
    this.setLabel(act.characterId, act.action);
    if (act.say) this.say(act.characterId, act.say);
  }

  setLabel(id: string, text: string) { const a = this.actors.get(id); if (a) a.label = text; }

  /** P5.3 — speech bubble (scene_2). */
  say(id: string, text: string, ms = 6000 + text.length * 40) {
    const a = this.actors.get(id); if (a) a.bubble = { text, until: performance.now() + ms };
  }

  /** P6.3 — inner-voice cue overlay (scene_3); does not pause anything. */
  innerVoice(text: string, ms = 7000) { this.voice = { text, until: performance.now() + ms }; }

  objectAtPixel(px: number, py: number) {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    return this.env.objects.find((o) => o.pos && x >= o.pos.x && x < o.pos.x + o.w && y >= o.pos.y && y < o.pos.y + o.h);
  }
  actorAtPixel(px: number, py: number) {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    return [...this.actors.values()].find((a) => a.tile.x === x && a.tile.y === y);
  }

  private frame = (t: number) => {
    const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    for (const a of this.actors.values()) {
      if (a.path.length) {
        const n = a.path[0];
        const dx = n.x - a.draw.x, dy = n.y - a.draw.y, d = Math.hypot(dx, dy), s = SPEED * dt;
        if (d <= s) { a.draw = { ...n }; a.tile = { ...n }; a.path.shift(); if (!a.path.length && a.onArrive) { const f = a.onArrive; a.onArrive = null; f(); } }
        else { a.draw = { x: a.draw.x + (dx / d) * s, y: a.draw.y + (dy / d) * s }; if (d < 0.5) a.tile = { ...n }; }
      }
    }
    this.render(t);
    this.raf = requestAnimationFrame(this.frame);
  };

  private render(now: number) {
    const { ctx, env } = this;
    ctx.fillStyle = '#4a4458';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    env.rooms.forEach((r, i) => {
      ctx.fillStyle = ROOM_COLORS[i % ROOM_COLORS.length];
      ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) ctx.strokeRect(x * TILE, y * TILE, TILE, TILE);
      ctx.fillStyle = 'rgba(60,50,70,0.35)';
      ctx.font = 'bold 13px system-ui';
      ctx.fillText(r.label.toUpperCase(), r.x * TILE + 6, (r.y + r.h) * TILE - 8);
    });
    ctx.fillStyle = '#c9b79c';
    for (const d of env.doors) ctx.fillRect(d.x * TILE, d.y * TILE, TILE, TILE);
    for (const o of env.objects) {
      if (!o.pos) continue;
      ctx.fillStyle = this.highlight === o.id ? '#ffe08a' : 'rgba(255,255,255,0.75)';
      ctx.strokeStyle = '#8a7a66';
      roundRect(ctx, o.pos.x * TILE + 2, o.pos.y * TILE + 2, o.w * TILE - 4, o.h * TILE - 4, 6);
      ctx.fill(); ctx.stroke();
      ctx.font = `${Math.min(o.w, o.h) * 22}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.emoji || '📦', (o.pos.x + o.w / 2) * TILE, (o.pos.y + o.h / 2) * TILE);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
    for (const a of this.actors.values()) {
      const cx = (a.draw.x + 0.5) * TILE, cy = (a.draw.y + 0.5) * TILE;
      ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = a.color; ctx.fill();
      ctx.lineWidth = a.isPlayer ? 3 : 1.5; ctx.strokeStyle = a.isPlayer ? '#111' : '#fff'; ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(a.name.slice(0, 1).toUpperCase(), cx, cy + 1);
      ctx.textBaseline = 'alphabetic';
      ctx.font = '11px system-ui'; ctx.fillStyle = '#222';
      ctx.fillText(a.name + (a.isPlayer ? ' (you)' : ''), cx, cy + TILE * 0.62 + 6);
      if (a.label) { ctx.fillStyle = '#6b5d7a'; ctx.font = 'italic 10px system-ui'; ctx.fillText(a.label.slice(0, 40), cx, cy + TILE * 0.62 + 18); }
      ctx.textAlign = 'start';
    }
    for (const a of this.actors.values()) {
      if (a.bubble && a.bubble.until > now) bubble(ctx, (a.draw.x + 0.5) * TILE, a.draw.y * TILE - 4, a.bubble.text, this.canvas.width);
    }
    if (this.voice && this.voice.until > now) {
      const alpha = Math.min(1, (this.voice.until - now) / 800);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(30,20,50,0.78)';
      const w = Math.min(this.canvas.width - 40, ctx.measureText(this.voice.text).width + 80);
      ctx.font = 'italic 16px Georgia, serif';
      const tw = Math.min(this.canvas.width - 60, ctx.measureText(this.voice.text).width + 40);
      roundRect(ctx, (this.canvas.width - Math.max(w, tw)) / 2, 10, Math.max(w, tw), 36, 18); ctx.fill();
      ctx.fillStyle = '#f5ecff'; ctx.textAlign = 'center';
      ctx.fillText(`💭 ${this.voice.text}`, this.canvas.width / 2, 34, this.canvas.width - 60);
      ctx.textAlign = 'start'; ctx.globalAlpha = 1;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, maxW: number) {
  ctx.font = '12px system-ui';
  const words = text.split(' '); const lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > 200) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, h = lines.length * 15 + 10;
  const bx = Math.max(4, Math.min(maxW - w - 4, x - w / 2)), by = Math.max(4, y - h - 8);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#555';
  roundRect(ctx, bx, by, w, h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#222';
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 17 + i * 15));
}
