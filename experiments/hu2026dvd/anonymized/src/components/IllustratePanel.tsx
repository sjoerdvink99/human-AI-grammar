import { useMemo, useState } from "react";
import { useApp } from "../App";
import { composeIllustrationRequest } from "../../shared/compose";
import { generateIllustration } from "../api";
import { download, svgDataUrl } from "../tools/raster";
import { uid } from "../state";

/** Process 4: [human select] element r13 → [tool_1 compose] request r14 → [model_2 generate]~ illustration r15. */
export function IllustratePanel() {
  const { state, dispatch } = useApp();
  const [targetId, setTargetId] = useState<string | null>(null); // r13
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = state.elements.find((e) => e.id === targetId) ?? null;
  const request = useMemo(() => (target ? composeIllustrationRequest(target) : null), [target]); // r14

  if (!state.elements.length)
    return (
      <div className="empty">
        <h2>No elements yet</h2>
        <p>Generate elements first; then pick one here to get a detailed illustration of it.</p>
      </div>
    );

  async function run() {
    if (!request || !target) return;
    setBusy(true);
    setError(null);
    try {
      const out = await generateIllustration(request);
      dispatch({
        type: "set",
        patch: {
          illustrations: [
            { id: uid("ill"), elementId: target.id, request, svg: out.svg, alt: out.alt, createdAt: Date.now() },
            ...state.illustrations,
          ],
        },
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const results = state.illustrations.filter((i) => !targetId || i.elementId === targetId);

  return (
    <div className="two-col">
      <section>
        <h2>Pick an element</h2>
        <div className="card-grid">
          {state.elements.map((el) => (
            <button key={el.id} className={`card ${el.id === targetId ? "sel" : ""}`} onClick={() => setTargetId(el.id)}>
              <span className="swatch" style={{ background: el.color }} />
              <b>{el.name}</b>
              <span className="kind">{el.kind}</span>
              <span className="muted small">{el.description.slice(0, 90)}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>Illustration request</h2>
        {!request && <p className="muted">Select an element to compose a request from it.</p>}
        {request && (
          <>
            <dl className="record">
              <dt>subject</dt>
              <dd>{request.subject}</dd>
              <dt>description</dt>
              <dd>{request.description || "—"}</dd>
              <dt>style</dt>
              <dd>{request.style}</dd>
              <dt>palette</dt>
              <dd>
                {request.palette.map((c) => (
                  <span key={c} className="swatch" style={{ background: c }} title={c} />
                ))}
              </dd>
              <dt>aspect</dt>
              <dd>{request.aspect}</dd>
            </dl>
            <button className="primary" onClick={run} disabled={busy}>
              {busy ? "Drawing…" : results.length ? "Generate another" : "Generate illustration"}
            </button>
            {busy && (
              <div className="loading">
                <div className="spinner" /> The illustrator model is drawing (this can take a minute)…
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}
        <div className="results">
          {results.map((ill) => (
            <figure key={ill.id} className="result">
              <img src={svgDataUrl(ill.svg)} alt={ill.alt} />
              <figcaption>
                <span>{state.elements.find((e) => e.id === ill.elementId)?.name ?? ill.request.subject}</span>
                <button className="ghost small" onClick={() => download(`illustration-${ill.id}.svg`, ill.svg)}>
                  Download
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
