// End of process 1 (P1.9 [human modify] characters_1 → characters_2) and process 2 (character interview).
import { useState } from "react";
import type { Update } from "../App";
import type { Character, Project } from "../shared/types";
import { isFloor } from "../shared/environment";
import SceneCanvas from "./SceneCanvas";
import CharacterInterview from "./CharacterInterview";

const COLORS = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#a8c686", "#8e5572", "#2a9d8f", "#d62828"];

export default function CharactersTab({ project: p, update, next }: { project: Project; update: Update; next: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(p.characters[0]?.id ?? null);
  const [placing, setPlacing] = useState(false);
  const [newTrait, setNewTrait] = useState("");
  const sel = p.characters.find((c) => c.id === selectedId) ?? null;
  const env = p.environment!;

  const edit = (id: string, patch: Partial<Character>) =>
    update((q) => ({ characters: q.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const setPlayer = (id: string) => update((q) => ({ characters: q.characters.map((c) => ({ ...c, isPlayer: c.id === id })) }));

  const addCharacter = () => {
    const id = `c${Date.now().toString(36)}`;
    update((q) => ({
      characters: [
        ...q.characters,
        { id, name: "New character", description: "", traits: [], isPlayer: q.characters.length === 0, color: COLORS[q.characters.length % COLORS.length], x: null, y: null },
      ],
    }));
    setSelectedId(id);
  };

  const onPointer = (kind: "down" | "move" | "up", x: number, y: number) => {
    if (kind !== "down") return;
    if (placing && sel) {
      const blocked = !isFloor(env, x, y) || p.objects.some((o) => o.x === x && o.y === y) || p.characters.some((c) => c.id !== sel.id && c.x === x && c.y === y);
      if (!blocked) {
        edit(sel.id, { x, y });
        setPlacing(false);
      }
      return;
    }
    const hit = p.characters.find((c) => c.x === x && c.y === y);
    if (hit) setSelectedId(hit.id);
  };

  const tokens = p.characters.filter((c) => c.x != null && c.y != null).map((c) => ({ ...c, x: c.x!, y: c.y! }));

  return (
    <div className="split">
      <section className="panel steps">
        <div className="step">
          <h3>Characters</h3>
          <div className="char-list">
            {p.characters.map((c) => (
              <button key={c.id} className={`char-pill ${c.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(c.id)}>
                <span className="dot" style={{ background: c.color }} />
                {c.name}
                {c.isPlayer && " ★"}
              </button>
            ))}
            <button onClick={addCharacter}>＋ Add</button>
          </div>
        </div>

        {sel && (
          <div className="step">
            <div className="row">
              <input type="color" value={sel.color} onChange={(e) => edit(sel.id, { color: e.target.value })} />
              <input className="grow" value={sel.name} onChange={(e) => edit(sel.id, { name: e.target.value })} />
              <label className="inline">
                <input type="radio" checked={sel.isPlayer} onChange={() => setPlayer(sel.id)} /> Player
              </label>
            </div>
            <textarea rows={3} value={sel.description} onChange={(e) => edit(sel.id, { description: e.target.value })} />
            <div className="chips">
              {sel.traits.map((t) => (
                <span key={t} className="chip">
                  {t} <button className="x" onClick={() => edit(sel.id, { traits: sel.traits.filter((x) => x !== t) })}>×</button>
                </span>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newTrait.trim() && !sel.traits.includes(newTrait.trim())) edit(sel.id, { traits: [...sel.traits, newTrait.trim()] });
                  setNewTrait("");
                }}
              >
                <input className="trait-input" placeholder="+ trait" value={newTrait} onChange={(e) => setNewTrait(e.target.value)} />
              </form>
            </div>
            <div className="row">
              <button className={placing ? "active" : ""} onClick={() => setPlacing(!placing)}>
                {placing ? "Click a floor tile…" : sel.x != null ? "Move start position" : "Place on map"}
              </button>
              <span className="muted">{sel.x != null ? `Starts at (${sel.x},${sel.y})` : "No start position (placed automatically)"}</span>
              <button
                className="danger"
                onClick={() => {
                  update((q) => ({
                    characters: q.characters.filter((c) => c.id !== sel.id),
                    events: q.events.map((e) => ({ ...e, characterIds: e.characterIds.filter((id) => id !== sel.id) })),
                  }));
                  setSelectedId(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {sel && <CharacterInterview key={sel.id} project={p} character={sel} update={update} />}

        <button className="primary next" disabled={!p.characters.some((c) => c.isPlayer)} onClick={next}>
          Next: plot →
        </button>
      </section>
      <section className="panel stage">
        <SceneCanvas environment={env} objects={p.objects} tokens={tokens} selectedId={selectedId} onPointer={onPointer} />
      </section>
    </div>
  );
}
