"use client";

import type { Range } from "@/domain/systems/filters";

const numberClass =
  "h-7 w-14 rounded border border-line-strong bg-white px-1.5 text-xs tabular-nums placeholder:text-faint focus:border-accent focus:outline-none";

function toBound(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

export function RangeInput({
  label,
  range,
  onChange,
  step = 1,
}: {
  label: string;
  range: Range;
  onChange: (range: Range) => void;
  step?: number;
}) {
  const active = range.min !== undefined || range.max !== undefined;
  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <span className={active ? "text-accent" : "text-muted"}>{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        aria-label={`${label} minimum`}
        placeholder="min"
        value={range.min ?? ""}
        onChange={(event) => onChange({ ...range, min: toBound(event.target.value) })}
        className={numberClass}
      />
      <span className="text-faint">–</span>
      <input
        type="number"
        min={0}
        step={step}
        aria-label={`${label} maximum`}
        placeholder="max"
        value={range.max ?? ""}
        onChange={(event) => onChange({ ...range, max: toBound(event.target.value) })}
        className={numberClass}
      />
    </div>
  );
}
