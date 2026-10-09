// draft (artifact language) with highlight_spans (selection language)* drawn in a backdrop behind the textarea.
// Process 4 [human select]: clicking inside a highlighted span. Process 7: origin_span is selected and flashed.
import { useEffect, useRef, type ReactNode } from 'react';
import type { HighlightSpan } from '../../../shared/types.ts';

export interface Flash {
  start: number;
  end: number;
  nonce: number;
  missing?: string;
}

interface Props {
  value: string;
  spans: HighlightSpan[];
  flash: Flash | null;
  activeSpanText?: string;
  onChange: (v: string) => void;
  onSpanClick: (s: HighlightSpan) => void;
}

export default function DraftEditor({ value, spans, flash, activeSpanText, onChange, onSpanClick }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const flashOn = useRef<Flash | null>(null);

  const syncScroll = () => {
    if (ta.current && back.current) back.current.scrollTop = ta.current.scrollTop;
  };

  useEffect(() => {
    if (!flash || flash.start < 0 || !ta.current) return;
    flashOn.current = flash;
    const el = ta.current;
    el.focus();
    el.setSelectionRange(flash.start, flash.end);
    // scroll the origin span into view using the backdrop's mark position
    requestAnimationFrame(() => {
      const mark = back.current?.querySelector<HTMLElement>('mark.flash');
      if (mark) el.scrollTop = Math.max(0, mark.offsetTop - el.clientHeight / 3);
      syncScroll();
    });
  }, [flash]);

  const handleClick = () => {
    const el = ta.current;
    if (!el || el.selectionStart !== el.selectionEnd) return;
    const pos = el.selectionStart;
    const hit = spans.find((s) => pos >= s.start && pos <= s.end && value.slice(s.start, s.end) === s.text);
    if (hit) onSpanClick(hit);
  };

  // Backdrop: text with <mark>s for highlight spans and the flashed origin span.
  const marks: { start: number; end: number; cls: string; key: string }[] = spans
    .filter((s) => value.slice(s.start, s.end) === s.text)
    .map((s) => ({ start: s.start, end: s.end, cls: s.text === activeSpanText ? 'hl active' : 'hl', key: s.id }));
  if (flash && flash.start >= 0 && flash.nonce === flashOn.current?.nonce) {
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].start < flash.end && marks[i].end > flash.start) marks.splice(i, 1);
    marks.push({ start: flash.start, end: flash.end, cls: 'flash', key: `flash-${flash.nonce}` });
  }
  marks.sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue;
    parts.push(value.slice(pos, m.start));
    parts.push(<mark key={m.key} className={m.cls}>{value.slice(m.start, m.end)}</mark>);
    pos = m.end;
  }
  parts.push(value.slice(pos) + '\n');

  return (
    <div className="draft-editor">
      <div ref={back} className="draft-backdrop" aria-hidden>
        {parts}
      </div>
      <textarea
        ref={ta}
        className="draft-input"
        value={value}
        spellCheck
        placeholder="Start writing. Phrases that match the knowledge graph will be highlighted…"
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onClick={handleClick}
      />
    </div>
  );
}
