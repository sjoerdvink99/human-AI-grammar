// The draft (artifact language). The author writes here (process 9: human modify);
// highlight spans (process 3) are drawn inline; clicking one is process 4's human select;
// the origin span of a gold node (process 7) is flashed and scrolled into view.
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { HighlightSpan } from "../../shared/types.ts";

export interface DraftEditorHandle {
  rectOfSpan(id: string): DOMRect | null;
}

interface Props {
  draft: string;
  spans: HighlightSpan[];
  activeSpanId: string | null;
  originSpan: { start: number; end: number } | null;
  status: string;
  onChange(draft: string): void;
  onClickSpan(span: HighlightSpan): void;
}

type Seg = { text: string; span?: HighlightSpan; origin?: boolean };

function segments(draft: string, spans: HighlightSpan[], origin: { start: number; end: number } | null): Seg[] {
  const marks: { start: number; end: number; span?: HighlightSpan; origin?: boolean }[] = spans.map((s) => ({ start: s.start, end: s.end, span: s }));
  if (origin) {
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].start < origin.end && origin.start < marks[i].end) marks.splice(i, 1);
    marks.push({ ...origin, origin: true });
  }
  marks.sort((a, b) => a.start - b.start);
  const out: Seg[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue;
    if (m.start > pos) out.push({ text: draft.slice(pos, m.start) });
    out.push({ text: draft.slice(m.start, m.end), span: m.span, origin: m.origin });
    pos = m.end;
  }
  out.push({ text: draft.slice(pos) + "\n" });
  return out;
}

export const DraftEditor = forwardRef<DraftEditorHandle, Props>(function DraftEditor(
  { draft, spans, activeSpanId, originSpan, status, onChange, onClickSpan }, ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    rectOfSpan(id) {
      const el = backRef.current?.querySelector(`[data-span="${id}"]`);
      return el ? el.getBoundingClientRect() : null;
    },
  }));

  const syncScroll = () => {
    if (taRef.current && backRef.current) backRef.current.scrollTop = taRef.current.scrollTop;
  };

  // process 7: scroll the origin span into view and select it
  useEffect(() => {
    if (!originSpan || !taRef.current || !backRef.current) return;
    const el = backRef.current.querySelector<HTMLElement>("[data-origin]");
    if (el) {
      taRef.current.scrollTop = Math.max(0, el.offsetTop - taRef.current.clientHeight / 3);
      syncScroll();
    }
    taRef.current.focus({ preventScroll: true });
    taRef.current.setSelectionRange(originSpan.start, originSpan.end);
  }, [originSpan]);

  const handleClick = () => {
    const ta = taRef.current;
    if (!ta || ta.selectionStart !== ta.selectionEnd) return;
    const pos = ta.selectionStart;
    const hit = spans.find((s) => pos >= s.start && pos <= s.end);
    if (hit) onClickSpan(hit);
  };

  return (
    <section className="pane draft-pane">
      <header className="pane-head">
        <h2>Draft</h2>
        <span className="muted small">{status}</span>
      </header>
      <div className="editor">
        <div className="editor-backdrop" ref={backRef} aria-hidden>
          {segments(draft, spans, originSpan).map((s, i) =>
            s.origin ? (
              <mark key={i} data-origin className="origin-mark">{s.text}</mark>
            ) : s.span ? (
              <mark key={i} data-span={s.span.id} className={`gap-mark ${s.span.id === activeSpanId ? "active" : ""}`}>{s.text}</mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </div>
        <textarea
          ref={taRef}
          className="editor-input"
          value={draft}
          spellCheck
          placeholder="Write your story here. After you pause typing for five seconds, phrases that may need domain knowledge are underlined. Click one to open its Knowledge Card."
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onClick={handleClick}
        />
      </div>
      <footer className="pane-foot muted small">
        {spans.length} highlighted phrase{spans.length === 1 ? "" : "s"} · {draft.trim() ? draft.trim().split(/\s+/).length : 0} words
      </footer>
    </section>
  );
});
