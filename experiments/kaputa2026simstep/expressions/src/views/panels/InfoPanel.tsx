import { useProject } from "../../state";

export function InfoPanel() {
  const { project: p } = useProject();
  return (
    <div className="panel">
      <h4>Learning goal</h4>
      <p>{p.learning_goal}</p>
      <h4>Scenario</h4>
      <p className="small">{p.scenario}</p>
      <h4>Procedure</h4>
      <pre className="prose">{p.procedure}</pre>
      {p.test_assessment && (
        <details>
          <summary>Verification assessment</summary>
          <pre className="prose">{p.test_assessment}</pre>
        </details>
      )}
    </div>
  );
}
