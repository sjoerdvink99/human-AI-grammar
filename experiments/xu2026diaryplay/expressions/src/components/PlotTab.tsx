// Process 3: activities (extract) → events (compose) → characters per event (assign) → edit → vignette (tool_2 compose).
import { useState } from "react";
import type { Update } from "../App";
import type { Activity, PlotEvent, Project } from "../shared/types";
import { api } from "../api";
import { useTask } from "../useTask";
import { composeVignette } from "../shared/engine";
import { Status } from "./WorldTab";
import SceneCanvas from "./SceneCanvas";

export default function PlotTab({ project: p, update, next }: { project: Project; update: Update; next: () => void }) {
  const task = useTask();
  const [title, setTitle] = useState(p.vignette?.title ?? "");
  const [problems, setProblems] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const env = p.environment!;

  // P3.1 [model extract]
  const extractActivities = () =>
    (!p.events.length || confirm("Re-extracting activities clears the current events. Continue?")) &&
    task.run("Extracting activities…", async () => {
      const r = await api<{ activities: Activity[] }>("extract-activities", {
        story: p.story,
        environment: env,
        objects: p.objects,
        characters: p.characters,
      });
      update({ activities: r.activities, events: [], vignette: null });
    });

  // P3.2 [model compose] then P3.3 [model assign]
  const composeEvents = () =>
    (!p.events.length || confirm("Replace the current events?")) &&
    task.run("Composing plot events…", async () => {
      const r1 = await api<{ events: PlotEvent[] }>("compose-events", {
        story: p.story,
        environment: env,
        objects: p.objects,
        characters: p.characters,
        activities: p.activities,
      });
      update({ events: r1.events });
      const r2 = await api<{ events: PlotEvent[] }>("assign-event-characters", { story: p.story, characters: p.characters, events: r1.events });
      update({ events: r2.events });
    });

  // P3.4 [human modify] events_2 → events_3
  const editEvent = (id: string, patch: Partial<PlotEvent>) =>
    update((q) => ({ events: q.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const moveEvent = (i: number, d: number) =>
    update((q) => {
      const ev = [...q.events];
      const j = i + d;
      if (j < 0 || j >= ev.length) return {};
      [ev[i], ev[j]] = [ev[j], ev[i]];
      return { events: ev };
    });
  const addEvent = () =>
    update((q) => ({
      events: [...q.events, { id: `e${Date.now().toString(36)}`, description: "Something happens.", activityId: null, roomId: null, characterIds: [] }],
    }));

  // P3.5 [tool_2 compose]
  const compose = () => {
    const r = composeVignette(p, title);
    setProblems(r.problems);
    if (r.vignette) update({ vignette: r.vignette });
  };

  const objName = (a: Activity) => {
    const o = p.objects.find((x) => x.id === a.objectId);
    return o ? `${o.emoji} ${o.name}` : a.objectId;
  };
  const focusEvent = p.events.find((e) => e.id === focus);
  const focusObj = focusEvent?.activityId ? p.objects.find((o) => o.id === p.activities.find((a) => a.id === focusEvent.activityId)?.objectId) : null;

  return (
    <div className="split">
      <section className="panel steps">
        <Status task={task} />
        <div className="step">
          <h3>Activities</h3>
          <button className="primary" disabled={!!task.busy} onClick={extractActivities}>
            {p.activities.length ? "Re-extract activities" : "Extract activities"}
          </button>
          {p.activities.length > 0 && (
            <details>
              <summary>{p.activities.length} activities on {new Set(p.activities.map((a) => a.objectId)).size} objects</summary>
              <ul className="compact">
                {p.activities.map((a) => (
                  <li key={a.id}>
                    <b>{a.verb}</b> {objName(a)} — <span className="muted">{a.description}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className={`step ${p.activities.length ? "" : "locked"}`}>
          <h3>Plot events</h3>
          <button className="primary" disabled={!!task.busy || !p.activities.length} onClick={composeEvents}>
            {p.events.length ? "Recompose events" : "Compose events"}
          </button>
          <ol className="events">
            {p.events.map((e, i) => (
              <li key={e.id} className={focus === e.id ? "focus" : ""} onFocus={() => setFocus(e.id)} onMouseEnter={() => setFocus(e.id)}>
                <div className="row">
                  <textarea className="grow" rows={2} value={e.description} onChange={(ev) => editEvent(e.id, { description: ev.target.value })} />
                  <div className="col">
                    <button onClick={() => moveEvent(i, -1)} title="Move up">↑</button>
                    <button onClick={() => moveEvent(i, 1)} title="Move down">↓</button>
                    <button className="danger" onClick={() => update((q) => ({ events: q.events.filter((x) => x.id !== e.id) }))} title="Delete">
                      ×
                    </button>
                  </div>
                </div>
                <div className="row small">
                  <label>Done when</label>
                  <select
                    value={e.activityId ?? (e.roomId ? `room:${e.roomId}` : "")}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      if (v.startsWith("room:")) editEvent(e.id, { activityId: null, roomId: v.slice(5) });
                      else editEvent(e.id, { activityId: v || null, roomId: null });
                    }}
                  >
                    <option value="">a moment passes</option>
                    <optgroup label="someone performs">
                      {p.activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.verb} {objName(a)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="characters reach">
                      {env.rooms.map((r) => (
                        <option key={r.id} value={`room:${r.id}`}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div className="chips">
                  {p.characters.map((c) => {
                    const on = e.characterIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        className={`chip selectable ${on ? "active" : ""}`}
                        style={{ borderColor: c.color }}
                        onClick={() =>
                          editEvent(e.id, { characterIds: on ? e.characterIds.filter((x) => x !== c.id) : [...e.characterIds, c.id] })
                        }
                      >
                        {c.name}
                        {c.isPlayer && " ★"}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          {p.activities.length > 0 && <button onClick={addEvent}>＋ Add event</button>}
        </div>

        <div className={`step ${p.events.length ? "" : "locked"}`}>
          <h3>Vignette</h3>
          <div className="row">
            <input className="grow" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className="primary" disabled={!p.events.length} onClick={compose}>
              {p.vignette ? "Recompose vignette" : "Compose vignette"}
            </button>
          </div>
          {problems.map((x) => (
            <p key={x} className="status error">
              {x}
            </p>
          ))}
          {p.vignette && (
            <>
              <p className="muted">
                “{p.vignette.title}”: {p.vignette.events.length} events, {p.vignette.characters.length} characters, {p.vignette.objects.length} objects. Recompose after
                further edits.
              </p>
              <button className="primary next" onClick={next}>
                Play →
              </button>
            </>
          )}
        </div>
      </section>
      <section className="panel stage">
        <SceneCanvas
          environment={env}
          objects={p.objects}
          tokens={p.characters.filter((c) => c.x != null).map((c) => ({ ...c, x: c.x!, y: c.y! }))}
          selectedId={focusObj?.id ?? null}
        />
      </section>
    </div>
  );
}
