"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";

export interface Option {
  value: string;
  count?: number;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);

  const summary = selected.length === 1 ? selected[0] : selected.length > 1 ? `${selected.length} selected` : null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cx(
          "inline-flex h-7 items-center gap-1 rounded border px-2 text-xs whitespace-nowrap transition-colors",
          summary ? "border-accent/50 bg-accent-wash text-accent" : "border-line-strong bg-white text-muted hover:text-ink",
        )}
      >
        <span className={summary ? "text-accent/80" : undefined}>{label}</span>
        {summary && <span className="max-w-40 truncate font-medium">{summary}</span>}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-20 max-h-72 min-w-48 overflow-y-auto rounded border border-line-strong bg-white py-1 shadow-[0_4px_16px_rgba(15,23,42,0.08)]">
          {options.length === 0 && <p className="px-3 py-1.5 text-xs text-faint">No values in corpus</p>}
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-wash"
              >
                <span
                  className={cx(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                    checked ? "border-accent bg-accent text-white" : "border-line-strong",
                  )}
                >
                  {checked && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="flex-1 font-mono">{option.value}</span>
                {option.count !== undefined && <span className="text-faint tabular-nums">{option.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
