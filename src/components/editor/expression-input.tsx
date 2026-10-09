"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { applyCompletion, complete, type Completion, type CompletionSource } from "@/domain/grammar/completion";
import { cx } from "@/lib/cx";

const padding = { top: 10, left: 12 };
const lineHeight = 24;

export function ExpressionInput({
  value,
  onChange,
  source,
  rows,
  invalid,
  placeholder,
  onFocusChange,
}: {
  value: string;
  onChange: (value: string) => void;
  source: CompletionSource;
  rows: number;
  invalid: boolean;
  placeholder: string;
  onFocusChange?: (focused: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const ruler = useRef<HTMLSpanElement>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const pendingCaret = useRef<number | null>(null);

  const suggest = (text: string, caret: number) => {
    const next = complete(text, caret, source);
    setCompletion(next);
    setHighlight(0);
    if (!next || !input.current || !ruler.current) return;
    const before = text.slice(0, next.from);
    const line = before.split("\n").length - 1;
    const column = next.from - before.lastIndexOf("\n") - 1;
    const charWidth = ruler.current.getBoundingClientRect().width / 10;
    setPosition({
      top: padding.top + (line + 1) * lineHeight - input.current.scrollTop,
      left: padding.left + column * charWidth - input.current.scrollLeft,
    });
  };

  const accept = (option: string) => {
    if (!completion) return;
    const next = applyCompletion(value, completion, option);
    pendingCaret.current = next.caret;
    onChange(next.text);
  };

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || !input.current) return;
    pendingCaret.current = null;
    input.current.setSelectionRange(caret, caret);
    suggest(value, caret);
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === " " && event.ctrlKey) {
      event.preventDefault();
      suggest(value, event.currentTarget.selectionStart);
      return;
    }
    if (!completion) return;
    const count = completion.options.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept(completion.options[highlight].value);
    } else if (event.key === "Escape" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
      setCompletion(null);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={input}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          suggest(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => {
          setCompletion(null);
          onFocusChange?.(false);
        }}
        onClick={() => setCompletion(null)}
        onScroll={() => setCompletion(null)}
        rows={rows}
        spellCheck={false}
        wrap="off"
        placeholder={placeholder}
        aria-label="Grammar expression"
        aria-autocomplete="list"
        className={cx(
          "block w-full resize-y bg-white px-3 py-2.5 font-mono text-[13px] leading-6 placeholder:text-faint focus:outline-none",
          invalid && "bg-[#fffafa]",
        )}
      />
      <span ref={ruler} aria-hidden className="invisible absolute top-0 left-0 font-mono text-[13px] whitespace-pre">
        0123456789
      </span>
      {completion && (
        <ul
          role="listbox"
          style={{ top: position.top, left: Math.max(0, position.left - 8) }}
          className="absolute z-20 max-h-60 min-w-44 overflow-auto rounded border border-line-strong bg-white py-1 shadow-md"
        >
          <li className="px-2 pb-1 text-[11px] text-faint">{completion.kind}</li>
          {completion.options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => {
                event.preventDefault();
                accept(option.value);
              }}
              onMouseEnter={() => setHighlight(index)}
              className={cx(
                "flex cursor-pointer items-baseline justify-between gap-4 px-2 font-mono text-[13px] leading-6",
                index === highlight && "bg-accent-wash text-accent",
              )}
            >
              {option.value}
              {option.detail && <span className="font-sans text-[11px] text-faint">{option.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
