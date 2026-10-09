import { cx } from "@/lib/cx";

export function TermList({ terms, shared, unique }: { terms: string[]; shared: string[]; unique: string[] }) {
  if (terms.length === 0) return <span className="text-faint">—</span>;
  const sorted = [...terms].sort(
    (a, b) => Number(unique.includes(b)) - Number(unique.includes(a)) || Number(shared.includes(a)) - Number(shared.includes(b)) || a.localeCompare(b),
  );
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[12.5px]">
      {sorted.map((term) => (
        <span
          key={term}
          className={cx(
            unique.includes(term) && "rounded-sm bg-accent-wash px-1 text-accent",
            shared.includes(term) && "text-muted",
          )}
        >
          {term}
        </span>
      ))}
    </span>
  );
}

export function TermLegend() {
  return (
    <span className="inline-flex items-center gap-3">
      <span>
        <span className="rounded-sm bg-accent-wash px-1 font-mono text-accent">term</span> only in this system
      </span>
      <span>
        <span className="font-mono text-muted">term</span> in all selected
      </span>
      <span>
        <span className="font-mono text-ink">term</span> in some
      </span>
    </span>
  );
}
