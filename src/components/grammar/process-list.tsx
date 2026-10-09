import type { ParsedProcess } from "@/domain/systems/types";
import { Expression, type Emphasis } from "./expression";
import { ParseErrorView } from "./parse-error-view";

export function ProcessList({ processes, emphasis }: { processes: ParsedProcess[]; emphasis?: Emphasis }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {processes.map((process, index) => (
        <li key={process.id} className="grid grid-cols-[2rem_1fr] gap-x-3 py-4">
          <span className="pt-0.5 font-mono text-xs text-faint tabular-nums">{String(index + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            {process.name && <p className="mb-1.5 text-xs font-medium text-muted">{process.name}</p>}
            {process.result.ok ? (
              <Expression process={process.result.process} emphasis={emphasis} />
            ) : (
              <ParseErrorView source={process.rawExpression} error={process.result.error} />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
