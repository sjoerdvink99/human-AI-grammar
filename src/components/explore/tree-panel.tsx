import Link from "next/link";
import type { TreeNode } from "@/domain/analysis/process-tree";
import type { SystemEntry } from "@/domain/systems/types";
import { plural, processAnchor } from "@/lib/format";
import { transformLabel } from "./treemap-layout";

export function TreePanel({ node, entries }: { node: TreeNode; entries: SystemEntry[] }) {
  const systems = entries.flatMap((entry) => {
    const processes = entry.processes.filter((process) => node.paths.some((path) => path.systemId === entry.id && path.processId === process.id));
    return processes.length ? [{ entry, processes }] : [];
  });

  // The overview root summarises its starting representations instead of listing every process.
  const overview = node.children.some((child) => !child.transform);

  return (
    <div>
      <h3 className="text-[15px] font-semibold">{node.types.join(" + ")}</h3>
      {node.transform && <p className="mt-0.5 font-mono text-xs text-muted">{transformLabel(node)}</p>}
      <p className="mt-3 text-xs text-muted tabular-nums">
        {plural(node.paths.length, "process", "processes")} in {plural(systems.length, "system")}
      </p>
      {overview ? (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
          <li className="text-muted">Starts from</li>
          {node.children.map((child) => (
            <li key={child.key} className="flex justify-between gap-3">
              <span>{child.types.join(" + ")}</span>
              <span className="font-mono text-muted tabular-nums">{child.paths.length}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 space-y-2.5 border-t border-line pt-3 text-[13px]">
          {systems.map(({ entry, processes }) => (
            <li key={entry.id}>
              <Link href={`/systems/${entry.id}`} className="font-medium hover:text-accent">
                {entry.name}
              </Link>
              <ul className="mt-0.5 text-xs text-muted">
                {processes.map((process) => (
                  <li key={process.id}>
                    <Link href={`/systems/${entry.id}#${processAnchor(process.order)}`} className="hover:text-ink">
                      {process.name ?? `Process ${process.order + 1}`}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
