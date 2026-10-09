// Renders environment + objects + characters: the spatial artifact in the editor and (scene: artifact visual) in play.
import { useEffect, useRef } from "react";
import type { Environment, GameObject } from "../shared/types";

export interface Token {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  isPlayer?: boolean;
  bubble?: string;
}

interface Props {
  environment: Environment;
  objects: GameObject[];
  tokens?: Token[];
  tile?: number;
  selectedId?: string | null;
  highlight?: { x: number; y: number } | null;
  onPointer?: (kind: "down" | "move" | "up", x: number, y: number) => void;
}

const ROOM_TINTS = ["#f4ead5", "#e7efe0", "#e6eaf3", "#f3e4e4", "#efe6f3", "#f2efdc", "#e0f0ef"];

export default function SceneCanvas({ environment: env, objects, tokens = [], tile = 30, selectedId, highlight, onPointer }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const down = useRef(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = env.width * tile * dpr;
    c.height = env.height * tile * dpr;
    c.style.width = `${env.width * tile}px`;
    c.style.height = `${env.height * tile}px`;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, env.width * tile, env.height * tile);

    // tiles
    for (let y = 0; y < env.height; y++)
      for (let x = 0; x < env.width; x++) {
        const t = env.tiles[y][x];
        if (t === "void") g.fillStyle = "#1d2330";
        else if (t === "wall") g.fillStyle = "#4a4e5a";
        else if (t === "door") g.fillStyle = "#a0703c";
        else {
          const ri = env.rooms.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
          g.fillStyle = ri >= 0 ? ROOM_TINTS[ri % ROOM_TINTS.length] : "#ddd6c6";
        }
        g.fillRect(x * tile, y * tile, tile, tile);
        if (t === "floor") {
          g.strokeStyle = "rgba(0,0,0,0.05)";
          g.strokeRect(x * tile + 0.5, y * tile + 0.5, tile - 1, tile - 1);
        }
      }

    // room names
    g.font = `600 ${Math.max(10, tile * 0.38)}px system-ui, sans-serif`;
    g.textBaseline = "top";
    g.textAlign = "left";
    for (const r of env.rooms) {
      g.fillStyle = "rgba(40,40,50,0.55)";
      g.fillText(r.name, r.x * tile + 4, r.y * tile + 3, r.w * tile - 8);
    }

    // objects
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const o of objects) {
      if (o.x == null || o.y == null) continue;
      if (o.id === selectedId) {
        g.strokeStyle = "#e4572e";
        g.lineWidth = 2;
        g.strokeRect(o.x * tile + 1, o.y * tile + 1, tile - 2, tile - 2);
        g.lineWidth = 1;
      }
      g.font = `${tile * 0.72}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
      g.fillText(o.emoji, o.x * tile + tile / 2, o.y * tile + tile / 2 + 1);
    }

    // characters
    for (const t of tokens) {
      const cx = t.x * tile + tile / 2;
      const cy = t.y * tile + tile / 2;
      g.beginPath();
      g.arc(cx, cy, tile * 0.4, 0, Math.PI * 2);
      g.fillStyle = t.color;
      g.fill();
      g.lineWidth = t.isPlayer ? 3 : t.id === selectedId ? 2 : 1;
      g.strokeStyle = t.isPlayer ? "#fff" : t.id === selectedId ? "#e4572e" : "rgba(0,0,0,0.4)";
      g.stroke();
      g.lineWidth = 1;
      g.fillStyle = "#fff";
      g.font = `700 ${tile * 0.42}px system-ui, sans-serif`;
      g.fillText(t.name.slice(0, 1).toUpperCase(), cx, cy + 1);
    }

    // speech bubbles (after tokens so they are on top)
    g.font = `${Math.max(11, tile * 0.4)}px system-ui, sans-serif`;
    for (const t of tokens) {
      if (!t.bubble) continue;
      const text = t.bubble.length > 60 ? t.bubble.slice(0, 57) + "…" : t.bubble;
      const w = Math.min(g.measureText(text).width + 12, tile * 10);
      const h = tile * 0.7;
      let bx = t.x * tile + tile / 2 - w / 2;
      bx = Math.max(2, Math.min(bx, env.width * tile - w - 2));
      const by = Math.max(2, t.y * tile - h - 4);
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.strokeStyle = t.color;
      g.beginPath();
      g.roundRect(bx, by, w, h, 6);
      g.fill();
      g.stroke();
      g.fillStyle = "#222";
      g.fillText(text, bx + w / 2, by + h / 2 + 1, w - 8);
    }

    if (highlight) {
      g.strokeStyle = "rgba(228,87,46,0.8)";
      g.setLineDash([4, 3]);
      g.strokeRect(highlight.x * tile + 1, highlight.y * tile + 1, tile - 2, tile - 2);
      g.setLineDash([]);
    }
  }, [env, objects, tokens, tile, selectedId, highlight]);

  const toTile = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / tile), y: Math.floor((e.clientY - r.top) / tile) };
  };

  return (
    <canvas
      ref={ref}
      className="scene"
      onMouseDown={(e) => {
        down.current = true;
        const p = toTile(e);
        onPointer?.("down", p.x, p.y);
      }}
      onMouseMove={(e) => {
        if (!down.current) return;
        const p = toTile(e);
        onPointer?.("move", p.x, p.y);
      }}
      onMouseUp={(e) => {
        down.current = false;
        const p = toTile(e);
        onPointer?.("up", p.x, p.y);
      }}
      onMouseLeave={() => (down.current = false)}
    />
  );
}
