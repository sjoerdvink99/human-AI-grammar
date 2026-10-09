import { useMemo, useState } from 'react';
import { composeGenerationInput, composeScopedInput } from '../shared/compose';
import { applyParameterEdit, applyStructureEdit, replaceSubtree } from '../shared/edits';
import type { ParameterEdit, StructureEdit } from '../shared/edits';
import { extractSubtree, findNode, translateScene } from '../shared/scene';
import * as api from './api';
import { AiEditPanel } from './AiEditPanel';
import { CodeView } from './CodeView';
import { ModelView } from './ModelView';
import { ParameterPanel } from './ParameterPanel';
import { StructureTree } from './StructureTree';

type Busy = null | 'generate' | 'followup' | 'ai';

const EXAMPLES = [
  'A cozy reading corner with an armchair, a floor lamp and a small side table',
  'A wooden desk with a monitor, keyboard and a potted plant',
  'A snowman on a snowy patch of ground',
  'A simple playground with a slide and a swing set',
];

export default function App() {
  // scene (artifact formal). sceneHistory keeps every earlier version of it.
  const [scene, setScene] = useState<string | null>(null);
  const [sceneHistory, setSceneHistory] = useState<string[]>([]);
  const [fitKey, setFitKey] = useState(0);

  const [prompt, setPrompt] = useState(''); // prompt_1
  const [followupPrompt, setFollowupPrompt] = useState(''); // followup_prompt_1
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null); // selected_node_1
  const [aiTargetId, setAiTargetId] = useState<string | null>(null); // ai_target_1
  const [localRequest, setLocalRequest] = useState(''); // local_request_1

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  // tool translate: scene → structure_tree + parameters (model_view renders from the tree)
  const translated = useMemo(() => {
    if (!scene) return null;
    try {
      return translateScene(scene);
    } catch (e) {
      console.error(e); // cannot happen for scenes committed through the validated steps
      return null;
    }
  }, [scene]);
  const tree = translated?.tree;
  const parameters = translated?.parameters;

  /** Commits scene_2 as the new current scene (the loop back to scene_1). */
  function commitScene(next: string, opts: { refit?: boolean } = {}) {
    if (scene) setSceneHistory((h) => [...h, scene]);
    setScene(next);
    if (opts.refit) setFitKey((k) => k + 1);
    setError(null);
  }

  function keepValid(id: string | null, code: string): string | null {
    if (!id) return null;
    return findNode(translateScene(code).tree, id) ? id : null;
  }

  // ---------------- process 1: prompt → compose → model generate → translate
  async function createScene(text = prompt) {
    try {
      const input = composeGenerationInput(text); // tool compose → generation_input_1
      setBusy('generate');
      setError(null);
      const next = await api.generateScene(input); // model generate~
      commitScene(next, { refit: true });
      setSelectedNodeId(null);
      setAiTargetId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---------------- process 6: followup prompt → compose → model generate → translate
  async function followUp() {
    if (!scene) return;
    try {
      const input = composeGenerationInput(followupPrompt, scene); // generation_input_2
      setBusy('followup');
      setError(null);
      const next = await api.generateScene(input);
      commitScene(next, { refit: true });
      setFollowupPrompt('');
      setSelectedNodeId((id) => keepValid(id, next));
      setAiTargetId((id) => keepValid(id, next));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---------------- process 3: parameter_edit → tool modify → translate (selection kept)
  function onParameterEdit(edit: ParameterEdit) {
    if (!scene) return;
    try {
      commitScene(applyParameterEdit(scene, edit));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ---------------- process 4: structure_target + structure_edit → tool modify → translate
  function onStructureEdit(edit: StructureEdit) {
    if (!scene) return;
    try {
      const { code, selectId } = applyStructureEdit(scene, edit);
      commitScene(code);
      setSelectedNodeId(selectId);
      setAiTargetId((id) => keepValid(id, code));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ---------------- process 5: ai_target + local_request → extract → compose → model modify → splice → translate
  const aiTarget = tree && aiTargetId ? findNode(tree, aiTargetId) : undefined;
  const subtree = useMemo(
    () => (scene && aiTargetId && aiTarget ? extractSubtree(scene, aiTargetId) : ''), // tool extract → subtree_1
    [scene, aiTargetId, aiTarget],
  );
  async function runAiEdit() {
    if (!scene || !aiTarget) return;
    try {
      const input = composeScopedInput(localRequest, subtree, { nodeId: aiTarget.id, name: aiTarget.name, type: aiTarget.type }, scene); // scoped_input_1
      setBusy('ai');
      setError(null);
      const subtree2 = await api.modifySubtree(input); // model modify~ → subtree_2
      const next = replaceSubtree(scene, aiTarget.id, subtree2); // tool modify → scene_2
      commitScene(next);
      setLocalRequest('');
      setSelectedNodeId(aiTarget.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---------------------------------------------------------------- views
  if (!scene || !tree || !parameters) {
    return (
      <div className="start">
        <h1>Scene Studio</h1>
        <p className="sub">Describe a 3D scene. The AI writes it as SceneScript code, which you can then edit through the tree, the parameters, the 3D view or more AI requests.</p>
        <textarea
          autoFocus
          rows={4}
          value={prompt}
          disabled={busy !== null}
          placeholder="Describe the scene you want…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createScene(); }}
        />
        <button className="primary big" disabled={busy !== null || !prompt.trim()} onClick={() => createScene()}>
          {busy === 'generate' ? <><span className="spinner" /> Generating scene…</> : 'Generate scene'}
        </button>
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} disabled={busy !== null} onClick={() => { setPrompt(ex); createScene(ex); }}>{ex}</button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  const disabled = busy !== null;
  return (
    <div className="app">
      <header>
        <span className="brand">Scene Studio</span>
        <input
          className="followup"
          value={followupPrompt}
          disabled={disabled}
          placeholder="Ask for a change to the whole scene, e.g. “add a rug under the table”"
          onChange={(e) => setFollowupPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && followUp()}
        />
        <button className="primary" disabled={disabled || !followupPrompt.trim()} onClick={followUp}>
          {busy === 'followup' ? <><span className="spinner" /> Updating…</> : 'Update scene'}
        </button>
        <button
          disabled={disabled}
          title="Start over with a new prompt"
          onClick={() => {
            if (confirm('Discard this scene and start a new one?')) {
              setScene(null);
              setSceneHistory([]);
              setSelectedNodeId(null);
              setAiTargetId(null);
            }
          }}
        >New</button>
        <span className="version">v{sceneHistory.length + 1}</span>
      </header>
      {error && <div className="error bar" onClick={() => setError(null)}>{error} <span>✕</span></div>}

      <aside className="left">
        <h2>Structure</h2>
        <StructureTree
          tree={tree}
          selectedId={selectedNodeId}
          aiTargetId={aiTargetId}
          disabled={disabled}
          onSelect={setSelectedNodeId}
          onStructureEdit={onStructureEdit}
          onAiTarget={(id) => { setAiTargetId(id); setLocalRequest(''); }}
        />
      </aside>

      <main>
        <div className="view-wrap">
          <ModelView tree={tree} selectedId={selectedNodeId} onSelect={setSelectedNodeId} fitKey={fitKey} />
          {busy && busy !== 'ai' && <div className="overlay"><span className="spinner" /> The model is writing the scene…</div>}
        </div>
        <div className="code-wrap">
          <h2>Scene code <span className="hint">click a line to select</span></h2>
          <CodeView code={scene} tree={tree} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
        </div>
      </main>

      <aside className="right">
        <section>
          <h2>Parameters</h2>
          <ParameterPanel
            params={selectedNodeId ? parameters[selectedNodeId] : undefined}
            disabled={disabled}
            onEdit={onParameterEdit}
          />
        </section>
        <section>
          <h2>✦ Edit part with AI</h2>
          <AiEditPanel
            target={aiTarget}
            subtree={subtree}
            request={localRequest}
            busy={busy === 'ai'}
            onRequestChange={setLocalRequest}
            onSubmit={runAiEdit}
            onClear={() => setAiTargetId(null)}
          />
        </section>
      </aside>
    </div>
  );
}
