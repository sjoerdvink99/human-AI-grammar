import { getSystem, listSystems } from "@/db/queries";
import { buildEntry } from "@/domain/systems/corpus";
import type { SystemEntry } from "@/domain/systems/types";

export function loadEntries(): SystemEntry[] {
  return listSystems().map(buildEntry);
}

export function loadEntry(id: number): SystemEntry | undefined {
  const record = Number.isInteger(id) ? getSystem(id) : undefined;
  return record && buildEntry(record);
}
