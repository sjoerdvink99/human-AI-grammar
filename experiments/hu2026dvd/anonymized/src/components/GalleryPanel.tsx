import { useState } from "react";
import { useApp } from "../App";
import { download, svgDataUrl } from "../tools/raster";

/** Process 8: snapshots r7* → [human select] r30 → [human evaluate] review r31. */
export function GalleryPanel() {
  const { state, dispatch } = useApp();
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const sel = state.snapshots.find((s) => s.id === selId) ?? null; // r30

  if (!state.snapshots.length)
    return (
      <div className="empty">
        <h2>Gallery is empty</h2>
        <p>Every rendered round of the scene is kept here for comparison and review.</p>
      </div>
    );

  return (
    <div className="gallery">
      <div className="thumbs">
        {[...state.snapshots].reverse().map((s) => (
          <button key={s.id} className={`thumb ${s.id === selId ? "sel" : ""}`} onClick={() => setSelId(s.id)}>
            <img src={svgDataUrl(s.scene.svg)} alt={`Round ${s.round}`} />
            <span>
              Round {s.round}
              {s.reviews.length > 0 && <span className="badge">{s.reviews.length}</span>}
            </span>
          </button>
        ))}
      </div>
      {sel ? (
        <div className="review">
          <div className="toolbar">
            <h2>Round {sel.round}</h2>
            <span className="muted small">{new Date(sel.createdAt).toLocaleString()}</span>
            <span className="grow" />
            <button className="ghost small" onClick={() => download(`round-${sel.round}.svg`, sel.scene.svg)}>
              Download SVG
            </button>
          </div>
          <img className="big" src={svgDataUrl(sel.scene.svg)} alt={`Round ${sel.round}`} />
          {sel.critique && (
            <p className="critique-note">
              <b>Critique before this round:</b> {sel.critique}
            </p>
          )}
          <h3>Reviews</h3>
          {sel.reviews.length === 0 && <p className="muted">No reviews yet.</p>}
          <ul className="reviews">
            {sel.reviews.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <textarea rows={3} placeholder="Your review of this version…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button
            className="primary"
            disabled={!draft.trim()}
            onClick={() => {
              dispatch({ type: "addReview", snapshotId: sel.id, text: draft.trim() });
              setDraft("");
            }}
          >
            Add review
          </button>
        </div>
      ) : (
        <div className="empty">
          <p>Select a round to review it.</p>
        </div>
      )}
    </div>
  );
}
