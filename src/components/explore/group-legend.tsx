import type { Grouping } from "@/domain/analysis/groups";
import type { SystemEntry } from "@/domain/systems/types";
import { plural } from "@/lib/format";
import { GroupMarker } from "./markers";

export function GroupLegend({ grouping, entries }: { grouping: Grouping; entries: SystemEntry[] }) {
  const names = new Map(entries.map((entry) => [entry.id, entry.name]));
  return (
    <div className="mt-4 border-t border-line pt-3">
      <ul className="space-y-1.5">
        {grouping.groups.map((group) => (
          <li key={group.index} className="flex items-baseline gap-2 text-xs">
            <span className="translate-y-0.5">
              <GroupMarker group={group.index} />
            </span>
            <span className="w-16 shrink-0 font-medium">Group {group.index + 1}</span>
            <span className="w-20 shrink-0 text-muted">{plural(group.systemIds.length, "system")}</span>
            <span className="w-[26rem] shrink-0 text-muted">
              {group.distinctive.length > 0
                ? `Higher ${group.distinctive.map((dimension) => dimension.label.toLowerCase()).join(", ")}`
                : "Close to the corpus mean"}
            </span>
            <span className="truncate text-faint">{group.systemIds.map((id) => names.get(id)).join(", ")}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">
        k-means over all structural dimensions after min–max normalization, initialized deterministically by farthest-first
        traversal. Groups are an exploratory aid, not a typology.
      </p>
    </div>
  );
}
