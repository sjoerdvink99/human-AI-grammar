import { useState } from "react";
import { MODEL_CHOICES, type ModelChoice, type WebCode } from "../../../shared/types.ts";
import { generate } from "../api.ts";

/** Process 2: request_1 + model_choice_1 → [model_1 generate]~ → code_1 */
export function GeneratePanel({ onGenerated, hasCode }: { onGenerated: (code: WebCode, label: string) => void; hasCode: boolean }) {
  const [request, setRequest] = useState("");
  const [modelChoice, setModelChoice] = useState<ModelChoice>("sonnet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (hasCode && !confirm("Replace the code in the editor with newly generated code? (Earlier versions stay in History.)")) return;
    setBusy(true);
    setError(null);
    try {
      onGenerated(await generate(request, modelChoice), `Generated (${modelChoice})`);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Generate</h2>
      <label className="field-label" htmlFor="request">Describe the frontend to build</label>
      <textarea
        id="request"
        rows={6}
        value={request}
        placeholder="e.g. A pomodoro timer with start/pause, a task list and an animated progress ring"
        onChange={(e) => setRequest(e.target.value)}
      />
      <div className="field-label">Coding model</div>
      <div className="segmented" role="radiogroup">
        {MODEL_CHOICES.map((m) => (
          <button key={m} role="radio" aria-checked={m === modelChoice} className={m === modelChoice ? "on" : ""} onClick={() => setModelChoice(m)}>
            {m}
          </button>
        ))}
      </div>
      <button className="primary" disabled={busy || !request.trim()} onClick={run}>
        {busy ? <span className="spinner">Generating…</span> : hasCode ? "Regenerate" : "Generate code"}
      </button>
      {error && <div className="error">{error}</div>}
    </section>
  );
}
