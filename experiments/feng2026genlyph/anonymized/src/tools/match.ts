import type { ComposedChart, Dataset, MatchQuery, MatchResult } from "../types.ts";

/** tool_4 match: r24 + r1 (+ r23 for the category field) -> r25 */
export function matchRows(r1: Dataset, r24: MatchQuery, r23: ComposedChart[]): MatchResult {
  const field = r24.field;
  const rowIndices: number[] = [];
  if (r24.op === "max" || r24.op === "min") {
    const nums = r1.rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
    if (nums.length) {
      const target = r24.op === "max" ? Math.max(...nums) : Math.min(...nums);
      r1.rows.forEach((r, i) => r[field] === target && rowIndices.push(i));
    }
  } else {
    r1.rows.forEach((r, i) => {
      if (test(r[field], r24.op, r24.value)) rowIndices.push(i);
    });
  }
  const chart = r23[0];
  const categories: MatchResult["categories"] = [];
  if (chart) {
    const counts = new Map<string, number>();
    for (const i of rowIndices) {
      const c = r1.rows[i][chart.categoryField];
      if (c !== null && c !== undefined) counts.set(String(c), (counts.get(String(c)) ?? 0) + 1);
    }
    for (const [category, rows] of counts) {
      if (category in chart.values) categories.push({ category, rows, value: chart.values[category] });
    }
  }
  return { rowIndices, categories };
}

function test(cell: unknown, op: MatchQuery["op"], raw: string): boolean {
  if (cell === null || cell === undefined) return false;
  const num = Number(raw);
  const numeric = typeof cell === "number" && raw.trim() !== "" && Number.isFinite(num);
  switch (op) {
    case "=":
      return numeric ? cell === num : String(cell).toLowerCase() === raw.toLowerCase();
    case "!=":
      return numeric ? cell !== num : String(cell).toLowerCase() !== raw.toLowerCase();
    case ">":
      return numeric && (cell as number) > num;
    case "<":
      return numeric && (cell as number) < num;
    case ">=":
      return numeric && (cell as number) >= num;
    case "<=":
      return numeric && (cell as number) <= num;
    case "contains":
      return String(cell).toLowerCase().includes(raw.toLowerCase());
    default:
      return false;
  }
}
