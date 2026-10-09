import { api, type Project } from "../api.ts";
import type { Act } from "../App.tsx";

/** Process 1 (r2…r7) and the human selection of process 2 (r7* -> r8). */
export default function ConceptsView({ project, act, next }: { project: Project; act: Act; next: () => void }) {
  const p = project;
  const running = p.busy?.step === "Find concepts";
  const shortlisted = new Set(p.shortlist);
  return (
    <section>
      <header>
        <h2>Video concepts</h2>
        <p className="muted">
          The model reads the document, extracts key points, brainstorms angles, pitches each one, scores the pitches, keeps a shortlist,
          and turns it into concept cards. Pick one to continue.
        </p>
      </header>
      <div className="row">
        <button disabled={!!p.busy} onClick={() => act(api.runP1)}>
          {p.concepts.length ? "Generate new concepts" : "Find concepts"}
        </button>
      </div>

      {p.concepts.length > 0 && (
        <div className="cards">
          {p.concepts.map((c, i) => {
            const chosen = p.concept?.title === c.title;
            return (
              <article key={i} className={`card concept ${chosen ? "chosen" : ""}`}>
                <h3>{c.title}</h3>
                <dl>
                  <dt>Audience</dt>
                  <dd>{c.audience}</dd>
                  <dt>Hook</dt>
                  <dd>“{c.hook}”</dd>
                  <dt>Tone</dt>
                  <dd>{c.tone}</dd>
                  <dt>Key message</dt>
                  <dd>{c.keyMessage}</dd>
                  <dt>Outline</dt>
                  <dd>
                    <ol>
                      {c.outline.map((o, j) => (
                        <li key={j}>{o}</li>
                      ))}
                    </ol>
                  </dd>
                  <dt>Length</dt>
                  <dd>≈ {c.targetSeconds}s</dd>
                </dl>
                <button
                  disabled={!!p.busy}
                  onClick={() => {
                    if (p.script && !confirm("Choosing a concept discards the current script and scenes. Continue?")) return;
                    act(() => api.selectConcept(i)).then(next);
                  }}
                >
                  {chosen ? "Chosen — choose again" : "Use this concept"}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {(p.keyPoints.length > 0 || running) && (
        <details className="trace" open={running}>
          <summary>How these concepts were found</summary>
          <Stage title="Key points" items={p.keyPoints} />
          <Stage title="Story angles" items={p.angles} />
          {p.pitches.length > 0 && (
            <div className="stage">
              <h4>Pitches and scores</h4>
              <table>
                <thead>
                  <tr>
                    <th>Pitch</th>
                    <th title="weighted: faithfulness ×2, clarity, engagement">Score</th>
                    <th>Faithful</th>
                    <th>Clear</th>
                    <th>Engaging</th>
                  </tr>
                </thead>
                <tbody>
                  {p.pitches.map((pitch, i) => {
                    const s = p.pitchScores[i];
                    return (
                      <tr key={i} className={shortlisted.has(pitch) ? "shortlisted" : ""}>
                        <td>
                          {shortlisted.has(pitch) && <span className="tag">shortlisted</span>} {pitch}
                          {s && <div className="muted small">{s.rationale}</div>}
                        </td>
                        <td>{s ? <Bar v={s.total} /> : "…"}</td>
                        <td>{s?.faithfulness ?? ""}</td>
                        <td>{s?.clarity ?? ""}</td>
                        <td>{s?.engagement ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

function Stage({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="stage">
      <h4>{title}</h4>
      <ol>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ol>
    </div>
  );
}

function Bar({ v }: { v: number }) {
  return (
    <div className="bar" title={`${v} / 10`}>
      <div style={{ width: `${v * 10}%` }} />
      <span>{v.toFixed(1)}</span>
    </div>
  );
}
