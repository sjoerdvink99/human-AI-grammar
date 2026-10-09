import type { Table } from "./types";

/** Parse CSV/TSV text (quoted fields supported) into a Table (r16). Numeric cells become numbers. */
export function parseTable(text: string): Table {
  const src = text.replace(/\r\n?/g, "\n").trim();
  if (!src) return { columns: [], rows: [] };
  const firstLine = src.split("\n")[0];
  const delim = firstLine.includes("\t") ? "\t" : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  records.push(row);
  const [header, ...body] = records.filter((r) => r.some((c) => c.trim() !== ""));
  const columns = header.map((h, i) => h.trim() || `col${i + 1}`);
  const rows = body.map((r) =>
    columns.map((_, i) => {
      const v = (r[i] ?? "").trim();
      const n = Number(v.replace(/,(?=\d{3}\b)/g, ""));
      return v !== "" && Number.isFinite(n) ? n : v;
    }),
  );
  return { columns, rows };
}

export function numericColumns(t: Table): number[] {
  return t.columns.map((_, i) => i).filter((i) => t.rows.length > 0 && t.rows.every((r) => typeof r[i] === "number"));
}
