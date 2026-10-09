/** P1.8 [human modify]: environment_1 + objects_2 -> environment_2 + objects_3 (direct manipulation). */
import { useRef, useState } from 'react';
import { canPlace, roomAt } from '../../shared/tool1';
import type { Environment, GameObject, Point } from '../../shared/types';

const T = 30;
const ROOM_COLORS = ['#f4ead5', '#e3efe6', '#e6ebf5', '#f5e6e8', '#efe9f7', '#f7f1df'];

export function placeOne(env: Environment, obj: GameObject): GameObject {
  const room = env.rooms.find((r) => r.id === obj.roomId);
  const others = env.objects.filter((o) => o.id !== obj.id);
  if (room) for (let y = room.y; y <= room.y + room.h - obj.h; y++) for (let x = room.x; x <= room.x + room.w - obj.w; x++)
    if (canPlace(env, obj, { x, y }, others)) return { ...obj, pos: { x, y } };
  return { ...obj, pos: null };
}

export default function EnvironmentCanvas({ env, onChange }: { env: Environment; onChange: (objects: GameObject[]) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; off: Point; at: Point } | null>(null);
  const [msg, setMsg] = useState('');
  const [newName, setNewName] = useState('');
  const [newRoom, setNewRoom] = useState(env.rooms[0]?.id ?? '');
  const svg = useRef<SVGSVGElement>(null);

  const tileAt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * env.width, y: ((e.clientY - r.top) / r.height) * env.height };
  };
  const setObjects = (objs: GameObject[]) => onChange(objs);
  const selected = env.objects.find((o) => o.id === sel);

  const updateObj = (o: GameObject, revalidate = false) => {
    let next = o;
    if (revalidate && o.pos && !canPlace(env, o, o.pos, env.objects.filter((x) => x.id !== o.id))) {
      next = placeOne(env, o);
      if (!next.pos) setMsg(`"${o.name}" no longer fits in its room; it is now unplaced.`);
    }
    setObjects(env.objects.map((x) => (x.id === o.id ? next : x)));
  };

  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const o = env.objects.find((x) => x.id === drag.id)!;
    const p = tileAt(e);
    const pos = { x: Math.round(p.x - drag.off.x), y: Math.round(p.y - drag.off.y) };
    const room = roomAt(env, { x: pos.x, y: pos.y });
    setDrag(null);
    if (!room) { setMsg('Objects must stay inside a room.'); return; }
    const moved = { ...o, roomId: room.id, pos };
    if (canPlace(env, moved, pos, env.objects.filter((x) => x.id !== o.id))) { setMsg(''); setObjects(env.objects.map((x) => (x.id === o.id ? moved : x))); }
    else setMsg('That spot is blocked (overlap, doorway, or it would cut off part of the floor).');
  };

  const unplaced = env.objects.filter((o) => !o.pos);

  return (
    <div className="envwrap">
      <svg ref={svg} viewBox={`0 0 ${env.width * T} ${env.height * T}`} className="envsvg"
        onPointerMove={(e) => { if (drag) setDrag({ ...drag, at: tileAt(e) }); }} onPointerUp={onUp} onPointerLeave={() => setDrag(null)}>
        <rect width={env.width * T} height={env.height * T} fill="#4a4458" />
        {env.rooms.map((r, i) => (
          <g key={r.id}>
            <rect x={r.x * T} y={r.y * T} width={r.w * T} height={r.h * T} fill={ROOM_COLORS[i % ROOM_COLORS.length]} />
            <text x={r.x * T + 6} y={(r.y + r.h) * T - 8} className="roomlabel">{r.label.toUpperCase()} ({r.id})</text>
          </g>
        ))}
        {env.doors.map((d, i) => <rect key={i} x={d.x * T} y={d.y * T} width={T} height={T} fill="#c9b79c" />)}
        {env.objects.filter((o) => o.pos).map((o) => {
          const pos = drag?.id === o.id ? { x: drag.at.x - drag.off.x, y: drag.at.y - drag.off.y } : o.pos!;
          return (
            <g key={o.id} className="envobj" transform={`translate(${pos.x * T},${pos.y * T})`}
              onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = tileAt(e); setSel(o.id); setDrag({ id: o.id, off: { x: p.x - o.pos!.x, y: p.y - o.pos!.y }, at: p }); }}>
              <rect x={2} y={2} width={o.w * T - 4} height={o.h * T - 4} rx={5} fill={sel === o.id ? '#ffe08a' : 'rgba(255,255,255,0.85)'} stroke="#8a7a66" />
              <text x={(o.w * T) / 2} y={(o.h * T) / 2 + 6} textAnchor="middle" fontSize={Math.min(o.w, o.h) * 18}>{o.emoji || '📦'}</text>
              <title>{o.name}</title>
            </g>
          );
        })}
      </svg>
      <p className="hint">Drag objects to move them (also between rooms). Click to edit. {msg && <span className="warn">{msg}</span>}</p>
      {unplaced.length > 0 && (
        <p className="warn">Not placed (no free space): {unplaced.map((o) => (
          <button key={o.id} className="link" onClick={() => setSel(o.id)}>{o.name}</button>
        ))}</p>
      )}
      {selected && (
        <div className="card objedit">
          <div className="row">
            <input style={{ width: '3em' }} value={selected.emoji} onChange={(e) => updateObj({ ...selected, emoji: e.target.value })} />
            <input value={selected.name} onChange={(e) => updateObj({ ...selected, name: e.target.value })} />
            <label>w <input type="number" min={1} max={4} value={selected.w} onChange={(e) => updateObj({ ...selected, w: Math.max(1, Math.min(4, +e.target.value)) }, true)} /></label>
            <label>h <input type="number" min={1} max={4} value={selected.h} onChange={(e) => updateObj({ ...selected, h: Math.max(1, Math.min(4, +e.target.value)) }, true)} /></label>
          </div>
          <div className="row">
            <label className="grow">Interactions (comma-separated)
              <input value={selected.affordances.join(', ')} onChange={(e) => updateObj({ ...selected, affordances: e.target.value.split(',').map((s) => s.trimStart()).filter((s, i, a) => s || i === a.length - 1) })} />
            </label>
            <label><input type="checkbox" checked={selected.againstWall} onChange={(e) => updateObj({ ...selected, againstWall: e.target.checked })} /> against wall</label>
          </div>
          <div className="row">
            {!selected.pos && <button onClick={() => { const p = placeOne(env, selected); setMsg(p.pos ? '' : 'Still no room for it — make it smaller or move other objects.'); updateObj(p); }}>Try to place</button>}
            <button className="danger" onClick={() => { setObjects(env.objects.filter((o) => o.id !== selected.id)); setSel(null); }}>Delete object</button>
            <button className="ghost" onClick={() => setSel(null)}>Close</button>
          </div>
        </div>
      )}
      <div className="row">
        <input placeholder="New object name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select value={newRoom} onChange={(e) => setNewRoom(e.target.value)}>
          {env.rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button disabled={!newName.trim()} onClick={() => {
          const id = `o-${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now() % 10000}`;
          const o = placeOne(env, { id, name: newName.trim(), roomId: newRoom, w: 1, h: 1, againstWall: false, emoji: '📦', affordances: ['use'], pos: null });
          setObjects([...env.objects, o]); setSel(id); setNewName('');
          setMsg(o.pos ? '' : 'No free space for the new object.');
        }}>Add object</button>
      </div>
    </div>
  );
}
