// Process 1: story + layouts → characters, layout, room labels, objects, environment (editable).
import { useMemo, useState } from "react";
import type { Update } from "../App";
import { api } from "../api";
import { useTask } from "../useTask";
import { LAYOUTS, getLayout } from "../shared/layouts";
import { buildEnvironment, roomAt, isFloor } from "../shared/environment";
import type { Character, GameObject, Project, RoomLabel, Tile } from "../shared/types";
import SceneCanvas from "./SceneCanvas";
import { SAMPLE_STORY } from "../sample";

type Tool = "select" | "wall" | "floor" | "door" | "add";

const CLEAR_AFTER: Record<string, Partial<Project>> = {
  characters: { layoutId: null, roomLabels: [], objects: [], environment: null, activities: [], events: [], vignette: null },
  layout: { roomLabels: [], objects: [], environment: null, activities: [], events: [], vignette: null },
  labels: { objects: [], environment: null, activities: [], events: [], vignette: null },
  objects: { environment: null, activities: [], events: [], vignette: null },
  environment: { activities: [], events: [], vignette: null },
};

export default function WorldTab({ project: p, update, next }: { project: Project; update: Update; next: () => void }) {
  const task = useTask();
  const [layoutReason, setLayoutReason] = useState("");
  const [suggestedLabels, setSuggestedLabels] = useState<RoomLabel[] | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const layout = getLayout(p.layoutId);
  const hasDownstream = (k: keyof typeof CLEAR_AFTER) =>
    Object.keys(CLEAR_AFTER[k]).some((f) => {
      const v = (p as any)[f];
      return Array.isArray(v) ? v.length > 0 : v != null;
    });
  const okToReplace = (k: keyof typeof CLEAR_AFTER) =>
    !hasDownstream(k) || confirm("This replaces the result and clears the later steps that depend on it. Continue?");

  // P1.1 [model extract]
  const extractCharacters = () =>
    okToReplace("characters") &&
    task.run("Extracting characters…", async () => {
      const r = await api<{ characters: Character[] }>("extract-characters", { story: p.story });
      update({ characters: r.characters, ...CLEAR_AFTER.characters });
    });

  // P1.2 [model select]
  const selectLayout = () =>
    okToReplace("layout") &&
    task.run("Choosing a floor plan…", async () => {
      const r = await api<{ layoutId: string; reason: string }>("select-layout", { story: p.story, characters: p.characters });
      setLayoutReason(r.reason);
      update({ layoutId: r.layoutId, ...CLEAR_AFTER.layout });
    });

  // P1.3 [model assign]
  const assignRoomLabels = () =>
    okToReplace("labels") &&
    task.run("Naming rooms…", async () => {
      const r = await api<{ roomLabels: RoomLabel[] }>("assign-room-labels", { story: p.story, layoutId: p.layoutId, characters: p.characters });
      setSuggestedLabels(r.roomLabels);
      update({ roomLabels: r.roomLabels, ...CLEAR_AFTER.labels });
    });

  // P1.4 [human modify] room_labels_1 → room_labels_2
  const editLabel = (roomId: string, field: "name" | "description", value: string) =>
    update((q) => ({
      roomLabels: q.roomLabels.map((l) => (l.roomId === roomId ? { ...l, [field]: value } : l)),
      environment: q.environment
        ? { ...q.environment, rooms: q.environment.rooms.map((r) => (r.id === roomId ? { ...r, [field]: value } : r)) }
        : null,
    }));

  // P1.5 [model generate]~
  const generateObjects = () =>
    okToReplace("objects") &&
    task.run("Generating objects…", async () => {
      const r = await api<{ objects: GameObject[] }>("generate-objects", {
        story: p.story,
        layoutId: p.layoutId,
        characters: p.characters,
        roomLabels: p.roomLabels,
      });
      update({ objects: r.objects, ...CLEAR_AFTER.objects });
    });

  // P1.6 [tool_1 execute] then P1.7 [model assign]
  const buildAndPlace = () =>
    okToReplace("environment") &&
    task.run("Building environment and placing objects…", async () => {
      if (!layout) return;
      const environment = buildEnvironment(layout, p.roomLabels);
      update({ environment, ...CLEAR_AFTER.environment });
      const r = await api<{ objects: GameObject[] }>("place-objects", { story: p.story, environment, objects: p.objects });
      update({ objects: r.objects });
    });

  // Preview of the selected layout before the environment exists.
  const preview = useMemo(() => (layout ? buildEnvironment(layout, p.roomLabels) : null), [layout, p.roomLabels]);
  const env = p.environment ?? preview;
  const selected = p.objects.find((o) => o.id === selectedId) ?? null;

  // P1.8 [human modify] environment_1 → environment_2, objects_2 → objects_3
  const onPointer = (kind: "down" | "move" | "up", x: number, y: number) => {
    const e = p.environment;
    if (!e || x < 0 || y < 0 || x >= e.width || y >= e.height) return;
    const objAt = p.objects.find((o) => o.x === x && o.y === y);
    if (tool === "select") {
      if (kind === "down") {
        setSelectedId(objAt?.id ?? null);
        setDragId(objAt?.id ?? null);
      } else if (kind === "up" && dragId) {
        if (isFloor(e, x, y) && !objAt) {
          const room = roomAt(e, x, y);
          update((q) => ({ objects: q.objects.map((o) => (o.id === dragId ? { ...o, x, y, roomId: room?.id ?? o.roomId } : o)) }));
        }
        setDragId(null);
      }
      return;
    }
    if (tool === "add") {
      if (kind !== "down" || !isFloor(e, x, y) || objAt) return;
      const room = roomAt(e, x, y);
      const id = `o${Date.now().toString(36)}`;
      update((q) => ({ objects: [...q.objects, { id, name: "New object", emoji: "📦", description: "", roomId: room?.id ?? e.rooms[0].id, x, y }] }));
      setSelectedId(id);
      setTool("select");
      return;
    }
    if (kind === "up") return;
    if (objAt && tool === "wall") return; // keep objects on floor
    const t: Tile = tool;
    if (e.tiles[y][x] === t) return;
    update((q) => {
      const tiles = q.environment!.tiles.map((row) => [...row]);
      tiles[y][x] = t;
      return { environment: { ...q.environment!, tiles } };
    });
  };

  const editObject = (patch: Partial<GameObject>) =>
    update((q) => ({ objects: q.objects.map((o) => (o.id === selectedId ? { ...o, ...patch } : o)) }));

  const roomName = (id: string) => p.roomLabels.find((l) => l.roomId === id)?.name ?? id;

  return (
    <div className="split">
      <section className="panel steps">
        <Status task={task} />

        <div className="step">
          <h3>Story</h3>
          <textarea rows={9} value={p.story} placeholder="Paste or write a short story…" onChange={(e) => update({ story: e.target.value })} />
          <div className="row">
            {!p.story && <button onClick={() => update({ story: SAMPLE_STORY })}>Use sample story</button>}
            <button className="primary" disabled={!!task.busy || p.story.trim().length < 20} onClick={extractCharacters}>
              {p.characters.length ? "Re-extract characters" : "Extract characters"}
            </button>
          </div>
          {p.characters.length > 0 && (
            <div className="chips">
              {p.characters.map((c) => (
                <span key={c.id} className="chip" style={{ borderColor: c.color }}>
                  {c.name}
                  {c.isPlayer && " ★"}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={`step ${p.characters.length ? "" : "locked"}`}>
          <h3>Floor plan</h3>
          <button className="primary" disabled={!!task.busy || !p.characters.length} onClick={selectLayout}>
            {p.layoutId ? "Choose again" : "Choose floor plan"}
          </button>
          <div className="gallery">
            {LAYOUTS.map((l) => (
              <figure key={l.id} className={l.id === p.layoutId ? "chosen" : ""}>
                <SceneCanvas environment={buildEnvironment(l, [])} objects={[]} tile={6} />
                <figcaption>{l.name}</figcaption>
              </figure>
            ))}
          </div>
          {layoutReason && <p className="muted">{layoutReason}</p>}
        </div>

        <div className={`step ${p.layoutId ? "" : "locked"}`}>
          <h3>Rooms</h3>
          <div className="row">
            <button className="primary" disabled={!!task.busy || !p.layoutId} onClick={assignRoomLabels}>
              {p.roomLabels.length ? "Rename rooms" : "Name rooms"}
            </button>
            {suggestedLabels && (
              <button onClick={() => update((q) => ({ roomLabels: suggestedLabels, environment: q.environment && buildEnvironmentRooms(q, suggestedLabels) }))}>
                Revert to suggestion
              </button>
            )}
          </div>
          {p.roomLabels.map((l) => (
            <div key={l.roomId} className="label-edit">
              <span className="tag">{l.roomId}</span>
              <input value={l.name} onChange={(e) => editLabel(l.roomId, "name", e.target.value)} />
              <input className="grow" value={l.description} onChange={(e) => editLabel(l.roomId, "description", e.target.value)} />
            </div>
          ))}
        </div>

        <div className={`step ${p.roomLabels.length ? "" : "locked"}`}>
          <h3>Objects</h3>
          <button className="primary" disabled={!!task.busy || !p.roomLabels.length} onClick={generateObjects}>
            {p.objects.length ? "Regenerate objects" : "Generate objects"}
          </button>
          {!p.environment && p.objects.length > 0 && (
            <ul className="compact">
              {p.roomLabels.map((l) => (
                <li key={l.roomId}>
                  <b>{l.name}:</b>{" "}
                  {p.objects
                    .filter((o) => o.roomId === l.roomId)
                    .map((o) => `${o.emoji} ${o.name}`)
                    .join(", ") || "—"}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={`step ${p.objects.length ? "" : "locked"}`}>
          <h3>Environment</h3>
          <button className="primary" disabled={!!task.busy || !p.objects.length} onClick={buildAndPlace}>
            {p.environment ? "Rebuild & re-place objects" : "Build environment & place objects"}
          </button>
          {p.environment && (
            <>
              <p className="muted">Edit the map: drag objects, paint tiles, add or delete objects.</p>
              <div className="toolbar">
                {(["select", "wall", "floor", "door", "add"] as Tool[]).map((t) => (
                  <button key={t} className={tool === t ? "active" : ""} onClick={() => setTool(t)}>
                    {{ select: "↖ Move", wall: "▦ Wall", floor: "▢ Floor", door: "🚪 Door", add: "＋ Object" }[t]}
                  </button>
                ))}
              </div>
              {selected && (
                <div className="object-edit">
                  <div className="row">
                    <input className="emoji" value={selected.emoji} onChange={(e) => editObject({ emoji: e.target.value })} />
                    <input className="grow" value={selected.name} onChange={(e) => editObject({ name: e.target.value })} />
                    <button
                      className="danger"
                      onClick={() => {
                        update((q) => ({ objects: q.objects.filter((o) => o.id !== selected.id) }));
                        setSelectedId(null);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <textarea rows={2} value={selected.description} onChange={(e) => editObject({ description: e.target.value })} />
                  <p className="muted">In {roomName(selected.roomId)} at ({selected.x},{selected.y})</p>
                </div>
              )}
              <button className="primary next" onClick={next}>
                Next: characters →
              </button>
            </>
          )}
        </div>
      </section>

      <section className="panel stage">
        {env ? (
          <SceneCanvas
            environment={env}
            objects={p.environment ? p.objects : []}
            selectedId={selectedId}
            onPointer={p.environment ? onPointer : undefined}
          />
        ) : (
          <div className="placeholder">The floor plan appears here once one is chosen.</div>
        )}
      </section>
    </div>
  );
}

function buildEnvironmentRooms(q: Project, labels: RoomLabel[]) {
  const e = q.environment!;
  return {
    ...e,
    rooms: e.rooms.map((r) => {
      const l = labels.find((x) => x.roomId === r.id);
      return l ? { ...r, name: l.name, description: l.description } : r;
    }),
  };
}

export function Status({ task }: { task: ReturnType<typeof useTask> }) {
  if (task.busy) return <div className="status busy"><span className="spinner" /> {task.busy}</div>;
  if (task.error)
    return (
      <div className="status error">
        {task.error} <button onClick={() => task.setError(null)}>✕</button>
      </div>
    );
  return null;
}
