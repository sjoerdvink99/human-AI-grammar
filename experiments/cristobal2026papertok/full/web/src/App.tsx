import { useCallback, useEffect, useState } from 'react';
import { api, type Project } from './api.ts';
import { Upload } from './steps/Upload.tsx';
import { ScriptOptions } from './steps/ScriptOptions.tsx';
import { VoiceStyle } from './steps/VoiceStyle.tsx';
import { ScriptEditor } from './steps/ScriptEditor.tsx';
import { Storyboard } from './steps/Storyboard.tsx';
import { Credits } from './steps/Credits.tsx';

type Step = 'scripts' | 'voice' | 'edit' | 'storyboard' | 'credits';
const STEPS: { key: Step; label: string; ready: (p: Project) => boolean }[] = [
  { key: 'scripts', label: 'Hooks & scripts', ready: () => true },
  { key: 'voice', label: 'Voiceover style', ready: (p) => !!p.script },
  { key: 'edit', label: 'Edit script', ready: (p) => !!p.script },
  { key: 'storyboard', label: 'Storyboard', ready: (p) => !!p.scenes },
  { key: 'credits', label: 'Credits & export', ready: (p) => !!p.scenes?.some((s) => s.activeClip !== null) },
];

function latestStep(p: Project): Step {
  if (p.credits) return 'credits';
  if (p.scenes) return 'storyboard';
  if (p.script) return 'voice';
  return 'scripts';
}

const routeId = () => location.hash.match(/^#\/p\/([a-z0-9-]+)/)?.[1] ?? null;

export function App() {
  const [id, setId] = useState<string | null>(routeId());
  const [project, setProject] = useState<Project | null>(null);
  const [step, setStep] = useState<Step>('scripts');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setId(routeId());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    if (!id) { setProject(null); return; }
    api.get(id).then((p) => { setProject(p); setStep(latestStep(p)); }).catch((e) => setError(e.message));
  }, [id]);

  const working = !!project && (!!project.busy || !!project.scenes?.some((s) => s.status === 'working'));
  useEffect(() => {
    if (!id || !working) return;
    const t = setInterval(() => api.get(id).then(setProject).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [id, working]);

  // Follow the process forward when a background step unlocks the next view.
  const [lastLatest, setLastLatest] = useState<Step | null>(null);
  useEffect(() => {
    if (!project) return;
    const l = latestStep(project);
    if (lastLatest && l !== lastLatest && STEPS.findIndex((s) => s.key === l) > STEPS.findIndex((s) => s.key === step)) setStep(l);
    setLastLatest(l);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Run an action that returns the updated project. */
  const act = useCallback(async (fn: () => Promise<Project>) => {
    setError(null);
    try { setProject(await fn()); } catch (e) { setError((e as Error).message); }
  }, []);

  if (!id || !project) {
    return (
      <div className="shell">
        <header className="top"><a href="#/" className="brand">Paper<span>→</span>Short</a></header>
        {error && <div className="error">{error}</div>}
        <Upload onCreated={(p) => { location.hash = `#/p/${p.id}`; setProject(p); setStep('scripts'); }} />
      </div>
    );
  }

  const props = { project, act };
  return (
    <div className="shell">
      <header className="top">
        <a href="#/" className="brand">Paper<span>→</span>Short</a>
        <div className="paper-title" title={project.paper.fileName}>{project.paper.title}</div>
      </header>
      <div className="layout">
        <nav className="rail">
          {STEPS.map((s, i) => (
            <button key={s.key} className={step === s.key ? 'active' : ''} disabled={!s.ready(project)} onClick={() => setStep(s.key)}>
              <span className="num">{i + 1}</span>{s.label}
            </button>
          ))}
        </nav>
        <main>
          {project.busy && <div className="busy"><span className="spinner" />{project.busy.task}: <b>{project.busy.stage}</b>…</div>}
          {(error || project.error) && <div className="error">{error || project.error}</div>}
          {step === 'scripts' && <ScriptOptions {...props} onChosen={() => setStep('voice')} />}
          {step === 'voice' && <VoiceStyle {...props} onEdit={() => setStep('edit')} />}
          {step === 'edit' && <ScriptEditor {...props} />}
          {step === 'storyboard' && <Storyboard {...props} />}
          {step === 'credits' && <Credits {...props} />}
        </main>
      </div>
    </div>
  );
}

export type StepProps = { project: Project; act: (fn: () => Promise<Project>) => Promise<void> };
