// Process 3: delivery advice → voice settings → first take.
// (r10 + r8) → [model_1 generate]~ → r12 → [human specify] → r10 + r13 → take pipeline (see take.ts)
import { useEffect, useRef, useState } from "react";
import { post } from "../api.ts";
import type { StepProps } from "../App.tsx";
import { useBusy } from "../state.ts";
import { Pipeline, Prose } from "../components/Pipeline.tsx";
import { DEFAULT_VOICE_SETTINGS, VoiceSettingsForm } from "../components/VoiceSettingsForm.tsx";
import { TAKE_PIPELINE, recordTake } from "../take.ts";

export function VoiceStep({ project, update }: StepProps) {
  const { busy, error, run } = useBusy();
  const [stage, setStage] = useState(-1);
  const script = project.scriptVersions[project.activeScript]?.text ?? "";
  const settings = project.voiceSettings ?? DEFAULT_VOICE_SETTINGS;
  const started = useRef(false);

  const advise = () =>
    run("advice", async () => {
      const { advice } = await post<{ advice: string }>("/api/delivery-advice", { script, styleSpec: project.styleSpec });
      update((p) => ({ ...p, deliveryAdvice: advice }));
    });

  // Triggered on entering the step without advice yet.
  useEffect(() => {
    if (!project.deliveryAdvice && !started.current && script) {
      started.current = true;
      advise();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const record = () =>
    run("take", async () => {
      const take = await recordTake(script, settings, project.takes.length + 1, setStage);
      update((p) => ({
        ...p,
        voiceSettings: settings,
        takes: [...p.takes, take],
        activeTakeId: take.id,
        reviews: { ...p.reviews, [take.id]: { qa: [] } },
        step: 3,
      }));
    }).finally(() => setStage(-1));

  return (
    <section className="step">
      <header>
        <h2>3 · Voice</h2>
        <p className="hint">Read the delivery advice, set the voice, and record a take of script v{project.activeScript + 1}.</p>
      </header>
      <div className="two-col">
        <div className="col">
          <div className="card">
            <div className="card-head">
              <h3>Delivery advice</h3>
              <button className="link" disabled={busy.advice} onClick={advise}>
                ↻ Regenerate
              </button>
            </div>
            {busy.advice ? <div className="skeleton">Reading the script…</div> : <Prose text={project.deliveryAdvice || "—"} />}
          </div>
          <details className="card">
            <summary>Script v{project.activeScript + 1}</summary>
            <Prose text={script} />
          </details>
        </div>
        <div className="col">
          <div className="card">
            <h3>Voice settings</h3>
            <VoiceSettingsForm value={settings} onChange={(v) => update((p) => ({ ...p, voiceSettings: v }))} />
            <button className="primary wide" disabled={busy.take || !script} onClick={record}>
              {busy.take ? "Recording…" : project.takes.length ? "Record another take" : "Record take"}
            </button>
            {stage >= 0 && <Pipeline steps={TAKE_PIPELINE} current={stage} />}
            {error && <div className="error">{error}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
