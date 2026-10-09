// Process 4: select a test -> run it live -> human verdict -> model picks repair target
// -> model suggests repair -> human approves changes -> model applies (simulation_code_guided_N).
import { useState } from "react";
import { UI_TEST_FEEDBACK, type RepairTarget, type SuggestedChange, type UiTestFeedback } from "../../../shared/types";
import { Busy, ErrorBox } from "../../components/Status";
import { post } from "../../lib/api";
import { useOp } from "../../lib/useOp";
import { currentCode, useProject } from "../../state";
import type { PanelProps } from "../Workspace";
import { ApproveList } from "./ApproveList";

const FEEDBACK_LABEL: Record<UiTestFeedback, string> = { works: "✓ Works", partially_works: "◐ Partially works", broken: "✗ Broken" };

export function TestsPanel({ frame, commitCode }: PanelProps) {
  const { project: p } = useProject();
  const op = useOp();
  const [uiTestId, setUiTestId] = useState<string | null>(null);
  const [log, setLog] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState<UiTestFeedback | null>(null);
  const [target, setTarget] = useState<RepairTarget | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedChange | null>(null);
  const ui_test = p.test_cases?.find((t) => t.id === uiTestId);
  const code = currentCode(p)!;

  const resetAfterSelect = () => {
    setLog(null);
    setFeedback(null);
    setTarget(null);
    setSuggestion(null);
  };

  const runLive = () =>
    op.run("Running test in the simulation", async () => {
      resetAfterSelect();
      setLog(await frame.current!.runTest(ui_test!.steps));
    });

  const about = () => `${ui_test!.title} — expected: ${ui_test!.expected}${log ? `\nRun log: ${log.join("; ")}` : ""}`;

  const judge = (fb: UiTestFeedback) => {
    setFeedback(fb);
    setTarget(null);
    setSuggestion(null);
    if (fb === "works") return;
    op.run("Diagnosing", async () => {
      const repair_target = await post<RepairTarget>("p4/repair-target", { simulation_code: code.html, ui_test_feedback: fb, about: about() });
      setTarget(repair_target);
      setSuggestion(await post<SuggestedChange>("p4/suggest", { simulation_code: code.html, repair_target, ui_test_feedback: fb, about: about() }));
    });
  };

  const apply = (approved_repair: SuggestedChange) =>
    op.run("Applying approved repair", async () => {
      const html = await post<string>("p4/apply", { simulation_code: code.html, approved_repair });
      commitCode("guided", html, `test "${ui_test!.title}": ${approved_repair.summary}`);
      resetAfterSelect();
    });

  if (!p.test_cases?.length) return <p>No test cases yet.</p>;
  return (
    <div className="panel">
      <ErrorBox error={op.error} onRetry={op.retry ?? undefined} />
      <h4>1. Pick a test case</h4>
      <div className="list">
        {p.test_cases.map((t) => (
          <label key={t.id} className={`list-item ${t.id === uiTestId ? "on" : ""}`}>
            <input type="radio" checked={t.id === uiTestId} onChange={() => (setUiTestId(t.id), resetAfterSelect())} />
            <div>
              <b>{t.title}</b>
              <div className="small">{t.purpose}</div>
            </div>
          </label>
        ))}
      </div>
      {ui_test && (
        <>
          <div className="small">
            <b>Steps:</b> {ui_test.steps.map((s) => `${s.action} ${s.selector}${s.value != null ? ` = ${s.value}` : ""}`).join(" → ")}
            <br />
            <b>Expected:</b> {ui_test.expected}
          </div>
          <button className="primary" disabled={!!op.busy} onClick={runLive}>
            ▶ Run in simulation
          </button>
        </>
      )}
      {log && (
        <>
          <h4>2. Watch the simulation, then judge</h4>
          <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="row">
            {UI_TEST_FEEDBACK.map((f) => (
              <button key={f} className={`verdict ${f} ${feedback === f ? "on" : ""}`} disabled={!!op.busy} onClick={() => judge(f)}>
                {FEEDBACK_LABEL[f]}
              </button>
            ))}
          </div>
        </>
      )}
      {feedback === "works" && <p className="ok">No repair needed.</p>}
      {op.busy && <Busy label={op.busy} />}
      {target && (
        <p>
          Repair target: <span className="tag">{target}</span>
        </p>
      )}
      {suggestion && <ApproveList suggestion={suggestion} busy={!!op.busy} onApprove={apply} onRegenerate={() => feedback && judge(feedback)} />}
    </div>
  );
}
