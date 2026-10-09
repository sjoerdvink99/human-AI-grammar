import type { Scene, Visual } from '../../shared/types';
import { VISUAL_KINDS } from '../../shared/schemas';

/** [human modify] scripts_1 -> scripts_2: direct editing of one scene record. */
export function SceneEditor({ scene, onChange }: { scene: Scene; onChange: (s: Scene) => void }) {
  const set = <K extends keyof Scene>(k: K, v: Scene[K]) => onChange({ ...scene, [k]: v });
  const setV = <K extends keyof Visual>(k: K, v: Visual[K]) => onChange({ ...scene, visual: { ...scene.visual, [k]: v } });
  return (
    <div className="scene-editor">
      <label>Title<input value={scene.title} onChange={(e) => set('title', e.target.value)} /></label>
      <label>Narration<textarea rows={3} value={scene.narration} onChange={(e) => set('narration', e.target.value)} /></label>
      <label>On-screen text<input value={scene.onScreenText} onChange={(e) => set('onScreenText', e.target.value)} /></label>
      <div className="row">
        <label>Visual
          <select value={scene.visual.kind} onChange={(e) => setV('kind', e.target.value as Visual['kind'])}>
            {VISUAL_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label>Duration (s)<input type="number" min={2} max={15} value={scene.durationSec} onChange={(e) => set('durationSec', Math.min(15, Math.max(2, Number(e.target.value) || 2)))} /></label>
        <label>Background<input type="color" value={scene.background} onChange={(e) => set('background', e.target.value)} /></label>
        <label>Accent<input type="color" value={scene.accent} onChange={(e) => set('accent', e.target.value)} /></label>
      </div>
      <label>Visual label<input value={scene.visual.label} onChange={(e) => setV('label', e.target.value)} /></label>
      {scene.visual.kind === 'big_number' && (
        <label>Value<input value={scene.visual.value} onChange={(e) => setV('value', e.target.value)} /></label>
      )}
      {(scene.visual.kind === 'bar' || scene.visual.kind === 'comparison') && (
        <div className="items">
          {scene.visual.items.map((it, i) => (
            <div className="row" key={i}>
              <input value={it.label} onChange={(e) => setV('items', scene.visual.items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
              <input type="number" value={it.value} onChange={(e) => setV('items', scene.visual.items.map((x, k) => (k === i ? { ...x, value: Number(e.target.value) } : x)))} />
              <button className="icon" onClick={() => setV('items', scene.visual.items.filter((_, k) => k !== i))}>×</button>
            </div>
          ))}
          {scene.visual.items.length < (scene.visual.kind === 'comparison' ? 2 : 6) && (
            <button className="ghost small" onClick={() => setV('items', [...scene.visual.items, { label: 'Item', value: 0 }])}>+ data point</button>
          )}
        </div>
      )}
    </div>
  );
}
