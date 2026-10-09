"use client";

import { X } from "lucide-react";
import { Select } from "@/components/ui/field";
import { maxCompared } from "@/domain/analysis/comparison";

export function CompareSelector({
  options,
  selectedIds,
  onChange,
}: {
  options: { id: number; name: string }[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const names = new Map(options.map((option) => [option.id, option.name]));
  const available = options.filter((option) => !selectedIds.includes(option.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selectedIds.map((id) => (
        <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded border border-line-strong pr-1 pl-2.5 text-[13px] font-medium">
          {names.get(id)}
          <button
            type="button"
            onClick={() => onChange(selectedIds.filter((selected) => selected !== id))}
            aria-label={`Remove ${names.get(id)}`}
            className="rounded p-0.5 text-faint hover:bg-wash hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {selectedIds.length < maxCompared && available.length > 0 && (
        <Select
          value=""
          onChange={(event) => onChange([...selectedIds, Number(event.target.value)])}
          className="h-7 border-dashed text-[13px] text-muted"
          aria-label="Add system to comparison"
        >
          <option value="">+ Add system…</option>
          {available.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      )}
      <span className="ml-1 text-xs text-faint">
        {selectedIds.length < 2 ? "Select 2–4 systems" : `${selectedIds.length} of ${maxCompared}`}
      </span>
    </div>
  );
}
