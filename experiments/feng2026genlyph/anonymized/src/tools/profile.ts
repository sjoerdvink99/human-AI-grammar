import type { ColumnProfile, DataProfile, Dataset } from "../types.ts";

/** tool_1 extract: r1 -> r2 */
export function profileData(r1: Dataset): DataProfile {
  const columns: ColumnProfile[] = r1.columns.map((name) => {
    const vals = r1.rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
    const nums = vals.filter((v): v is number => typeof v === "number");
    const distinctSet = new Set(vals.map(String));
    if (nums.length > 0 && nums.length === vals.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      return {
        name,
        type: "number",
        distinct: distinctSet.size,
        min: Math.min(...nums),
        max: Math.max(...nums),
        mean: sum / nums.length,
        sum,
      };
    }
    const isCategory = distinctSet.size <= Math.max(12, r1.rows.length * 0.6) && distinctSet.size <= 30;
    return {
      name,
      type: isCategory ? "category" : "text",
      distinct: distinctSet.size,
      values: isCategory ? [...distinctSet].slice(0, 30) : undefined,
    };
  });
  return {
    rowCount: r1.rows.length,
    columns,
    defaultCategory: columns.find((c) => c.type === "category")?.name,
    defaultValue: columns.find((c) => c.type === "number")?.name,
  };
}

/** tool_1 translate: r2 -> r3 */
export function describeProfile(r2: DataProfile, datasetName: string): string {
  const lines = [`Dataset "${datasetName}" with ${r2.rowCount} rows and ${r2.columns.length} columns.`];
  for (const c of r2.columns) {
    if (c.type === "number")
      lines.push(`- "${c.name}": numeric, range ${fmt(c.min!)} to ${fmt(c.max!)}, mean ${fmt(c.mean!)}, total ${fmt(c.sum!)}.`);
    else if (c.type === "category")
      lines.push(`- "${c.name}": categorical with ${c.distinct} values: ${c.values!.slice(0, 12).join(", ")}${c.distinct > 12 ? ", …" : ""}.`);
    else lines.push(`- "${c.name}": free text (${c.distinct} distinct values).`);
  }
  if (r2.defaultCategory && r2.defaultValue)
    lines.push(`The main view is likely "${r2.defaultValue}" per "${r2.defaultCategory}".`);
  return lines.join("\n");
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("en-US");
  return Number(n.toFixed(2)).toString();
}

/** Group rows by a category field and aggregate a value field. */
export function aggregate(
  r1: Dataset,
  categoryField: string,
  valueField: string,
  agg: "sum" | "mean" | "count",
): { category: string; value: number; rows: number; indices: number[] }[] {
  const groups = new Map<string, { sum: number; n: number; indices: number[] }>();
  r1.rows.forEach((row, i) => {
    const key = row[categoryField];
    if (key === null || key === undefined) return;
    const k = String(key);
    const g = groups.get(k) ?? { sum: 0, n: 0, indices: [] };
    const v = row[valueField];
    if (typeof v === "number") g.sum += v;
    g.n++;
    g.indices.push(i);
    groups.set(k, g);
  });
  return [...groups.entries()].map(([category, g]) => ({
    category,
    rows: g.n,
    indices: g.indices,
    value: agg === "count" || !valueField ? g.n : agg === "mean" ? g.sum / g.n : g.sum,
  }));
}
