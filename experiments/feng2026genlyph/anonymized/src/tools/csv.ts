import type { Cell, Dataset } from "../types.ts";

/** Minimal RFC-4180 CSV parser with numeric coercion. Produces r1. */
export function parseCsv(text: string, name = "data.csv"): Dataset {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === "," || c === "\t" || c === ";") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) records.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) records.push(row);
  if (records.length < 2) throw new Error("CSV needs a header row and at least one data row");
  const columns = records[0].map((c, i) => c.trim() || `column_${i + 1}`);
  const rows = records.slice(1).map((r) => {
    const o: Record<string, Cell> = {};
    columns.forEach((c, i) => (o[c] = coerce(r[i])));
    return o;
  });
  return { name, columns, rows };
}

function coerce(v: string | undefined): Cell {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) && /^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?$/i.test(t) ? n : t;
}
