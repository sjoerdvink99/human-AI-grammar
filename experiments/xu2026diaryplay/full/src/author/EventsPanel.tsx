/** Process 3 — Schedule and refine key events, then compose the vignette. */
import { useState } from 'react';
import { api } from '../api';
import { useTask } from '../store';
import { composeVignette, sortedEvents } from '../../shared/runtime';
import type { Activity, KeyEvent, Project } from '../../shared/types';

type Props = { project: Project; update: (p: Partial<Project> | ((p: Project) => Partial<Project>)) => void };

export default function EventsPanel({ project: p, update }: Props) {
  const { busy, error, run, setBusy } = useTask();
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const env = p.environment!;
  const placed = env.objects.filter((o) => o.pos);
  const events = sortedEvents(p.events);
  const player = p.characters.find((c) => c.isPlayer);

  // P3.1 extract -> P3.2 compose -> P3.3 assign
  const generate = () => run('Extracting activities…', async () => {
    const { activities } = await api.extractActivities({ story: p.story, environment: env, characters: p.characters });
    update({ activities, events: [], vignetteId: null });
    setBusy('Grouping concurrent activities into events…');
    const c = await api.composeEvents({ story: p.story, characters: p.characters, activities });
    setBusy('Putting events in chronological order…');
    const o = await api.orderEvents({ story: p.story, events: c.events, activities, characters: p.characters });
    update({ events: o.events });
  });

  // P3.4 human modify helpers (events_3)
  const setAct = (id: string, patch: Partial<Activity>) => update((q) => ({ activities: q.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)), vignetteId: null }));
  const setEvents = (f: (ev: KeyEvent[]) => KeyEvent[]) => update((q) => ({ events: f(sortedEvents(q.events)).map((e, i) => ({ ...e, order: i + 1 })), vignetteId: null }));
  const removeAct = (id: string) => update((q) => ({ activities: q.activities.filter((a) => a.id !== id), events: q.events.map((e) => ({ ...e, activityIds: e.activityIds.filter((x) => x !== id) })), vignetteId: null }));
  const addAct = (eventId: string) => {
    const id = `a${Date.now() % 1000000}`;
    update((q) => ({
      activities: [...q.activities, { id, characterId: player?.id ?? q.characters[0].id, action: 'does something', objectId: null, description: '' }],
      events: q.events.map((e) => (e.id === eventId ? { ...e, activityIds: [...e.activityIds, id] } : e)), vignetteId: null,
    }));
  };
  const moveAct = (actId: string, toEvent: string) => setEvents((ev) => ev.map((e) => ({
    ...e, activityIds: e.id === toEvent ? [...e.activityIds.filter((x) => x !== actId), actId] : e.activityIds.filter((x) => x !== actId),
  })));
  const moveEvent = (i: number, d: number) => setEvents((ev) => { const n = [...ev]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x); return n; });

  // P3.5 tool_2 compose -> vignette_1
  const complete = () => run('Composing vignette…', async () => {
    const id = p.vignetteId ?? `v${Date.now().toString(36)}`;
    const res = composeVignette(p, id, title.trim() || p.story.split(/[.!?]/)[0].slice(0, 50));
    setErrors(res.errors);
    if (!res.vignette) return;
    await api.saveVignette(res.vignette);
    update({ vignetteId: id });
  });

  return (
    <div className="cols">
      <section className="col wide">
        <div className="card">
          <h2>Key events</h2>
          <p className="muted">The model reads the story, your personas and the environment, and schedules what each character does. Fix missing or wrong activities and objects below. The player must do their own activities during play; other characters do theirs.</p>
          <button className="primary" disabled={!!busy} onClick={generate}>{p.events.length ? 'Re-extract key events' : 'Extract key events'}</button>
          {busy && <p className="busy">⏳ {busy}</p>}
          {error && <p className="error">⚠ {error}</p>}
        </div>
        {events.map((e, i) => (
          <div key={e.id} className="card event">
            <div className="row">
              <span className="evnum">{i + 1}</span>
              <input className="grow evtitle" value={e.title} onChange={(ev) => setEvents((all) => all.map((x) => (x.id === e.id ? { ...x, title: ev.target.value } : x)))} />
              <button className="ghost small" disabled={i === 0} onClick={() => moveEvent(i, -1)}>↑</button>
              <button className="ghost small" disabled={i === events.length - 1} onClick={() => moveEvent(i, 1)}>↓</button>
              <button className="danger small" onClick={() => { e.activityIds.forEach(removeAct); setEvents((all) => all.filter((x) => x.id !== e.id)); }}>✕</button>
            </div>
            <table className="acts">
              <thead><tr><th>Character</th><th>Action</th><th>Object</th><th>Event</th><th /></tr></thead>
              <tbody>
                {e.activityIds.map((aid) => p.activities.find((a) => a.id === aid)).filter(Boolean).map((a) => (
                  <tr key={a!.id} className={p.characters.find((c) => c.id === a!.characterId)?.isPlayer ? 'playerrow' : ''}>
                    <td><select value={a!.characterId} onChange={(ev) => setAct(a!.id, { characterId: ev.target.value })}>
                      {p.characters.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isPlayer ? ' (player)' : ''}</option>)}
                    </select></td>
                    <td><input value={a!.action} onChange={(ev) => setAct(a!.id, { action: ev.target.value })} /></td>
                    <td><select value={a!.objectId ?? ''} onChange={(ev) => setAct(a!.id, { objectId: ev.target.value || null })}>
                      <option value="">(no object)</option>
                      {placed.map((o) => <option key={o.id} value={o.id}>{o.emoji} {o.name} · {env.rooms.find((r) => r.id === o.roomId)?.label}</option>)}
                    </select></td>
                    <td><select value={e.id} onChange={(ev) => moveAct(a!.id, ev.target.value)}>
                      {events.map((x, j) => <option key={x.id} value={x.id}>{j + 1}</option>)}
                    </select></td>
                    <td><button className="danger small" onClick={() => removeAct(a!.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="ghost small" onClick={() => addAct(e.id)}>+ activity</button>
          </div>
        ))}
        {p.events.length > 0 && <button className="ghost" onClick={() => setEvents((ev) => [...ev, { id: `e${Date.now() % 1000000}`, order: ev.length + 1, title: 'New event', activityIds: [] }])}>+ Add event</button>}
      </section>
      <section className="col">
        <div className="card">
          <h2>Complete the vignette</h2>
          <label>Title <input value={title} placeholder="e.g. Sunday soup at Grandma's" onChange={(e) => setTitle(e.target.value)} /></label>
          <button className="primary" disabled={!p.events.length || !!busy} onClick={complete}>Complete vignette</button>
          {errors.length > 0 && <ul className="error">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {p.vignetteId && (
            <p>✅ Saved. <a href={`#/play/${p.vignetteId}`}>▶ Play the vignette</a></p>
          )}
          <p className="small muted">Activities without an object are performed in play from the “Do…” menu (Q). Player rows are highlighted.</p>
        </div>
      </section>
    </div>
  );
}
