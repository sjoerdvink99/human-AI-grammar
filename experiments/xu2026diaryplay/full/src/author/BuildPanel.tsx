/** Process 1 — Build the environment and characters. */
import { api } from '../api';
import { useTask } from '../store';
import { LAYOUTS, getLayout } from '../../shared/layouts';
import { placeObjects } from '../../shared/tool1';
import type { Character, GameObject, Project } from '../../shared/types';
import EnvironmentCanvas from './EnvironmentCanvas';

type Props = { project: Project; update: (p: Partial<Project> | ((p: Project) => Partial<Project>)) => void };

const SAMPLE = `Every Sunday evening I visit my grandmother Rosa. When I arrive she is already in the kitchen stirring a pot of soup on the stove. I set the table while my little brother Leo plays with his toy cars on the living room rug. Grandma calls us to eat and we all sit at the dining table. After dinner Leo falls asleep on the sofa, and Grandma and I wash the dishes at the sink while she tells me stories about her childhood.`;

export default function BuildPanel({ project: p, update }: Props) {
  const { busy, error, run, setBusy } = useTask();
  const layout = getLayout(p.layoutId);

  // P1.1 extract -> P1.2 select -> P1.3 assign (model steps run in sequence)
  const analyse = () => run('Extracting characters…', async () => {
    const { characters } = await api.extractCharacters({ story: p.story });
    update({ characters, layoutId: null, roomLabels: {}, objects: [], environment: null, activities: [], events: [], vignetteId: null });
    const sel = await runStep('Choosing a room layout…', () => api.selectLayout({ story: p.story, characters }));
    update({ layoutId: sel.layoutId, layoutReason: sel.reason });
    const { roomLabels } = await runStep('Labelling rooms…', () => api.assignRoomLabels({ story: p.story, layoutId: sel.layoutId, characters }));
    update({ roomLabels });
  });
  const runStep = <T,>(label: string, f: () => Promise<T>) => { setBusy(label); return f(); };

  // P1.5 generate~ -> P1.6 tool_1 execute -> P1.7 assign
  const generateObjects = () => run('Generating objects…', async () => {
    const { objects } = await api.generateObjects({ story: p.story, layoutId: p.layoutId, characters: p.characters, roomLabels: p.roomLabels });
    const env1 = placeObjects(layout!, p.roomLabels, objects); // tool_1
    update({ objects: env1.objects, environment: env1, activities: [], events: [], vignetteId: null });
    const res = await runStep('Assigning object interactions…', () => api.assignObjects({ story: p.story, environment: env1, characters: p.characters, objects: env1.objects }));
    update({ objects: res.objects, environment: { ...env1, objects: res.objects } });
  });

  // P1.8 human modify (objects_3 / environment_2)
  const setObjects = (objects: GameObject[]) => update((q) => ({ objects, environment: q.environment && { ...q.environment, objects } }));

  // P1.9 human modify (characters_2)
  const setChar = (id: string, patch: Partial<Character>) => update((q) => ({
    characters: q.characters.map((c) => (c.id === id ? { ...c, ...patch } : patch.isPlayer ? { ...c, isPlayer: false } : c)),
  }));

  return (
    <div className="cols">
      <section className="col">
        <div className="card">
          <h2>Story</h2>
          <textarea rows={9} value={p.story} placeholder="Write a short everyday story (a few sentences, in first person works well)…" onChange={(e) => update({ story: e.target.value })} />
          <div className="row">
            <button className="primary" disabled={!p.story.trim() || !!busy} onClick={analyse}>{p.characters.length ? 'Re-analyse story' : 'Analyse story'}</button>
            {!p.story && <button className="ghost" onClick={() => update({ story: SAMPLE })}>Use sample story</button>}
          </div>
        </div>

        {layout && (
          <div className="card">
            <h2>Rooms</h2>
            <p className="muted">Layout chosen by the model: <b>{layout.name}</b>{p.layoutReason && <> — {p.layoutReason}</>}</p>
            <LayoutPreview layoutId={layout.id} labels={p.roomLabels} />
            {layout.rooms.map((r) => (
              <label key={r.id} className="row">
                <span className="tag">Room {r.id} · {r.w}×{r.h}</span>
                <input value={p.roomLabels[r.id] ?? ''} onChange={(e) => update((q) => ({ roomLabels: { ...q.roomLabels, [r.id]: e.target.value } }))} />
              </label>
            ))}
            <button className="primary" disabled={!!busy || layout.rooms.some((r) => !p.roomLabels[r.id]?.trim())} onClick={generateObjects}>
              {p.environment ? 'Regenerate objects' : 'Generate & place objects'}
            </button>
            {p.environment && <p className="muted small">Regenerating replaces all objects and clears key events.</p>}
          </div>
        )}

        {p.characters.length > 0 && (
          <div className="card">
            <h2>Characters</h2>
            {p.characters.map((c) => (
              <details key={c.id} className="charcard" open={p.characters.length <= 2}>
                <summary><span className="dot" style={{ background: c.color }} /> <b>{c.name}</b> {c.isPlayer && <span className="tag">player</span>}</summary>
                <label>Name <input value={c.name} onChange={(e) => setChar(c.id, { name: e.target.value })} /></label>
                <label className="inline"><input type="radio" checked={c.isPlayer} onChange={() => setChar(c.id, { isPlayer: true })} /> The player controls this character</label>
                {(['description', 'personality', 'background', 'goals', 'speakingStyle'] as const).map((f) => (
                  <label key={f}>{f === 'speakingStyle' ? 'Speaking style' : f[0].toUpperCase() + f.slice(1)}
                    <textarea rows={2} value={c[f]} onChange={(e) => setChar(c.id, { [f]: e.target.value })} />
                  </label>
                ))}
                <label>Traits <input value={c.traits.join(', ')} onChange={(e) => setChar(c.id, { traits: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></label>
                <button className="danger small" onClick={() => update((q) => ({ characters: q.characters.filter((x) => x.id !== c.id) }))}>Remove character</button>
              </details>
            ))}
            <button className="ghost" onClick={() => update((q) => ({
              characters: [...q.characters, { id: `c-new-${Date.now() % 100000}`, name: 'New character', isPlayer: q.characters.length === 0, description: '', personality: '', background: '', goals: '', speakingStyle: '', traits: [], color: ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9b5de5', '#f15bb5'][q.characters.length % 6] }],
            }))}>+ Add character</button>
          </div>
        )}
      </section>

      <section className="col wide">
        <div className="card">
          <h2>Environment</h2>
          {busy && <p className="busy">⏳ {busy}</p>}
          {error && <p className="error">⚠ {error}</p>}
          {p.environment ? <EnvironmentCanvas env={p.environment} onChange={setObjects} /> : <p className="muted">Analyse the story, check the room labels, then generate objects. The environment appears here.</p>}
        </div>
      </section>
    </div>
  );
}

function LayoutPreview({ layoutId, labels }: { layoutId: string; labels: Record<string, string> }) {
  const l = LAYOUTS.find((x) => x.id === layoutId)!;
  const T = 10;
  return (
    <svg viewBox={`0 0 ${l.width * T} ${l.height * T}`} className="layoutpreview">
      <rect width={l.width * T} height={l.height * T} fill="#4a4458" />
      {l.rooms.map((r) => (
        <g key={r.id}>
          <rect x={r.x * T} y={r.y * T} width={r.w * T} height={r.h * T} fill="#f4ead5" />
          <text x={(r.x + r.w / 2) * T} y={(r.y + r.h / 2) * T} textAnchor="middle" fontSize={9}>{r.id}: {labels[r.id] ?? ''}</text>
        </g>
      ))}
      {l.doors.map((d, i) => <rect key={i} x={d.x * T} y={d.y * T} width={T} height={T} fill="#c9b79c" />)}
    </svg>
  );
}
