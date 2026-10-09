import { useState } from "react";
import { SceneMode } from "./modes/SceneMode";
import { SketchMode } from "./modes/SketchMode";
import { CollageMode } from "./modes/CollageMode";

const MODES = [
  { id: "scene", label: "Scene", sub: "ground plan → 3D → image → region edits", C: SceneMode },
  { id: "sketch", label: "Sketch", sub: "sketch → image", C: SketchMode },
  { id: "collage", label: "Voice collage", sub: "boxes + voice → items → collage", C: CollageMode },
] as const;

export function App() {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("scene");
  return (
    <div className="app">
      <header>
        <h1>System X</h1>
        <nav className="tabs">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
              {m.label}<small>{m.sub}</small>
            </button>
          ))}
        </nav>
      </header>
      {/* Modes stay mounted so switching tabs keeps each process's state. */}
      {MODES.map(({ id, C }) => (
        <main key={id} hidden={mode !== id}><C /></main>
      ))}
    </div>
  );
}
