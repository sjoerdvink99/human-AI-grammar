import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModelView } from './components/ModelView';
import { StructureTree } from './components/StructureTree';
import { ParameterPanel } from './components/ParameterPanel';
import { LocalEditBox } from './components/LocalEditBox';
import { PromptBar } from './components/PromptBar';
import { SceneText } from './components/SceneText';
import { editNode, generateScene } from './api';
import {
  applyParameterEdit,
  applyStructureEdit,
  countNodes,
  findNode,
  normalizeScene,
  subtreeIds,
  type ParameterEdit,
  type Scene,
  type StructureEdit,
} from './shared/scene';

const STORAGE_KEY = 'systemx.scene';

type Busy = { kind: 'generate' | 'regenerate' | 'edit'; label: string; started: number } | null;

function loadStored(): Scene | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeScene(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function App() {
  // scene: the shared, continuously updated artifact (scene_1 -> scene_2 -> …)
  const [scene, setScene] = useState<Scene | null>(loadStored);
  // selected_node / structure_target / ai_target: one shared selection referring into the scene
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [showText, setShowText] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (scene) localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
    else localStorage.removeItem(STORAGE_KEY);
  }, [scene]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [busy]);

  // drop a selection that no longer exists after an update
  useEffect(() => {
    if (scene && selectedId && !findNode(scene, selectedId)) setSelectedId(null);
  }, [scene, selectedId]);

  // linked_highlight: [tool translate] selected_node -> highlighted subtree in both views
  const highlightIds = useMemo(() => (scene ? subtreeIds(scene, selectedId) : new Set<string>()), [scene, selectedId]);
  const selectedNode = scene && selectedId ? findNode(scene, selectedId) : null;

  // Processes 1 and 6
  const onGenerate = useCallback(
    async (prompt: string, useCurrent: boolean) => {
      setError(null);
      setBusy({ kind: useCurrent ? 'regenerate' : 'generate', label: useCurrent ? 'Regenerating the whole object with the current scene as context' : 'Generating scene', started: Date.now() });
      try {
        const { scene: next } = await generateScene(prompt, useCurrent && scene ? scene : undefined);
        setScene(next);
        setSelectedId(null);
        setFrameKey((k) => k + 1);
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [scene],
  );

  // Process 5
  const onLocalEdit = useCallback(
    async (request: string) => {
      if (!scene || !selectedId) return false;
      setError(null);
      const target = findNode(scene, selectedId);
      setBusy({ kind: 'edit', label: `Editing “${target?.name}” with AI`, started: Date.now() });
      try {
        const { scene: next } = await editNode(scene, selectedId, request);
        setScene(next);
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [scene, selectedId],
  );

  // Process 3: parameter_edit -> [tool modify]
  const onParameterEdit = useCallback((edit: ParameterEdit) => {
    setScene((s) => (s ? applyParameterEdit(s, edit) : s));
  }, []);

  // Process 4: structure_edit -> [tool modify]
  const onStructureEdit = useCallback(
    (edit: StructureEdit) => {
      if (!scene) return;
      try {
        const { scene: next, focusId } = applyStructureEdit(scene, edit);
        setScene(next);
        setSelectedId(focusId);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [scene],
  );

  // keyboard: Delete removes the selected node, Escape clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') setSelectedId(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && scene && selectedId && selectedId !== scene.root.id && !busy) {
        onStructureEdit({ op: 'delete', nodeId: selectedId });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scene, selectedId, busy, onStructureEdit]);

  const isBusy = !!busy;
  const counts = scene ? countNodes(scene) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          System X <span className="muted">text → editable 3D assemblies</span>
        </div>
        <PromptBar
          hasScene={!!scene}
          busy={isBusy}
          running={busy?.kind === 'generate' || busy?.kind === 'regenerate'}
          onGenerate={onGenerate}
          onNew={() => {
            setScene(null);
            setSelectedId(null);
          }}
        />
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <main className={scene ? 'workspace' : 'workspace empty-ws'}>
        {scene && (
          <aside className="left">
            <StructureTree scene={scene} selectedId={selectedId} highlightIds={highlightIds} onSelect={setSelectedId} onEdit={onStructureEdit} disabled={isBusy} />
          </aside>
        )}

        <section className="center">
          <div className="viewport">
            <ModelView scene={scene} selectedId={selectedId} highlightIds={highlightIds} onSelect={setSelectedId} frameKey={frameKey} />
            {scene && (
              <div className="view-info">
                <b>{scene.title}</b> · {counts!.parts} parts · {counts!.groups} groups
                {selectedNode && (
                  <>
                    {' '}
                    · selected: <span className="accent">{selectedNode.name}</span>
                  </>
                )}
              </div>
            )}
            {scene && <div className="view-hint">Click a part to select · click again for its subassembly · drag to orbit · Esc to clear</div>}
            {!scene && !busy && (
              <div className="welcome">
                <h2>Describe an object to start</h2>
                <p>The model writes an editable assembly tree. You can then inspect parts, tweak parameters, restructure the tree, ask AI to edit one subassembly, or regenerate the whole object.</p>
              </div>
            )}
            {busy && (
              <div className="busy">
                <div className="spinner" />
                <div>
                  {busy.label}… {Math.round((now - busy.started) / 1000)}s
                </div>
              </div>
            )}
          </div>
          {scene && (
            <div className={showText ? 'text-drawer open' : 'text-drawer'}>
              <button className="drawer-toggle" onClick={() => setShowText((v) => !v)}>
                {showText ? '▾' : '▸'} Scene description (JSON)
              </button>
              {showText && <SceneText scene={scene} selectedId={selectedId} />}
            </div>
          )}
        </section>

        {scene && (
          <aside className="right">
            <ParameterPanel node={selectedNode} onEdit={onParameterEdit} disabled={isBusy} />
            <LocalEditBox target={selectedNode} busy={isBusy} running={busy?.kind === 'edit'} onSubmit={onLocalEdit} />
          </aside>
        )}
      </main>
    </div>
  );
}
