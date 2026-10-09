import type { DraftContext, TextSpan } from "../shared/types";
import { MarkedText } from "./MarkedText";

interface Props {
  draft: string;
  onDraftChange: (s: string) => void; // P9 · [human modify]
  mode: "write" | "review";
  setMode: (m: "write" | "review") => void;
  draftContext: DraftContext;
  groundedSpans: TextSpan[];
  selectedSpan: TextSpan | null;
  onSelectSpan: (s: TextSpan) => void; // P4 · [human select]
  draftNodeSpans: TextSpan[]; // r26
  selectedMapNodeLabel: string | null;
  canGround: boolean;
  grounding: boolean;
  groundedVersion: number | null;
  onGround: () => void; // P3 trigger
}

/** r5 (draft) — editable in Write mode; highlighted spans (r11, r26) in Review mode. */
export function DraftEditor(p: Props) {
  const stale = p.groundedVersion !== null && p.groundedVersion !== p.draftContext.draftVersion;
  return (
    <section className="panel draft">
      <header>
        <h2>Draft</h2>
        <div className="seg">
          <button className={p.mode === "write" ? "on" : ""} onClick={() => p.setMode("write")}>
            Write
          </button>
          <button className={p.mode === "review" ? "on" : ""} onClick={() => p.setMode("review")}>
            Review
          </button>
        </div>
        <button className="primary" disabled={!p.canGround || p.grounding} onClick={p.onGround}>
          {p.grounding ? "Grounding…" : "Ground draft"}
        </button>
      </header>
      <div className="context-bar" title="Draft context (r7), recomposed after every edit">
        {p.draftContext.wordCount} words · {p.draftContext.paragraphs.length} paragraphs · v{p.draftContext.draftVersion}
        {p.draftContext.mapConcepts.length > 0 && <> · map: {p.draftContext.mapConcepts.join(", ")}</>}
        {stale && <span className="warn"> · draft edited since grounding — highlights re-located, re-ground to refresh</span>}
      </div>
      {p.mode === "write" ? (
        <textarea
          className="draft-text"
          value={p.draft}
          placeholder="Write your draft here…"
          onChange={(e) => p.onDraftChange(e.target.value)}
        />
      ) : (
        <div className="draft-text review">
          {p.draft ? (
            <MarkedText
              text={p.draft}
              layers={[
                { spans: p.groundedSpans, className: "grounded", onClick: p.onSelectSpan, activeRef: p.selectedSpan?.refId },
                { spans: p.draftNodeSpans, className: "mapnode" },
              ]}
            />
          ) : (
            <span className="muted">Empty draft. Switch to Write.</span>
          )}
        </div>
      )}
      <div className="legend">
        <span>
          <i className="sw grounded" /> grounded in the knowledge graph — click for a suggestion
        </span>
        {p.selectedMapNodeLabel && (
          <span>
            <i className="sw mapnode" /> mentions of “{p.selectedMapNodeLabel}” ({p.draftNodeSpans.length})
          </span>
        )}
      </div>
    </section>
  );
}
