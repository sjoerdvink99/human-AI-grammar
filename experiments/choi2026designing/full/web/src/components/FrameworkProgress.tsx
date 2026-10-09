import type { Session, TherapyFramework } from "../api.ts";

/** therapy_framework + required_variables + step_status, shown as a progress tracker. */
export function FrameworkProgress({ framework, session }: { framework: TherapyFramework; session: Session }) {
  const inTherapy = session.phase === "therapy";
  return (
    <details className="card framework" open={inTherapy}>
      <summary>
        <h2>What we've talked about</h2>
        <span className="muted">
          {Math.min(session.stepStatus.currentStep, framework.steps.length)} of {framework.steps.length} steps
        </span>
      </summary>
      <ol className="steps">
        {framework.steps.map((step, i) => {
          const state = i < session.stepStatus.currentStep ? "done" : i === session.stepStatus.currentStep && inTherapy ? "current" : "todo";
          return (
            <li key={step.id} className={`step ${state}`}>
              <div className="step-head">
                <span className="step-dot" aria-hidden>{state === "done" ? "✓" : i + 1}</span>
                <strong>{step.title}</strong>
              </div>
              <dl>
                {step.variables.map((v) => (
                  <div key={v.key} className={session.requiredVariables[v.key] ? "filled" : "empty"}>
                    <dt>{v.key.replace(/_/g, " ")}</dt>
                    <dd>{session.requiredVariables[v.key] || "—"}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
