export interface LegendItem {
  label: string;
  color: string;
  path: string;
}

const rowHeight = 18;
const gap = 22;
const charWidth = 6.2;

export function legendRows(items: LegendItem[], available: number) {
  if (items.length === 0) return [];
  const rows: { item: LegendItem; offset: number }[][] = [[]];
  let offset = 0;
  for (const item of items) {
    const itemWidth = 16 + item.label.length * charWidth;
    if (offset > 0 && offset + itemWidth > available) {
      rows.push([]);
      offset = 0;
    }
    rows[rows.length - 1].push({ item, offset });
    offset += itemWidth + gap;
  }
  return rows;
}

export const legendHeight = (rows: unknown[]) => (rows.length > 0 ? 6 + rows.length * rowHeight : 0);

export function SvgLegend({ rows, x, y }: { rows: ReturnType<typeof legendRows>; x: number; y: number }) {
  return rows.map((row, index) => (
    <g key={index} transform={`translate(${x},${y + 6 + index * rowHeight + rowHeight / 2})`}>
      {row.map(({ item, offset }) => (
        <g key={item.label} transform={`translate(${offset},0)`}>
          <path d={item.path} transform="translate(5,0)" fill={item.color} />
          <text x={16} dy="0.32em" className="fill-muted text-[11px]">
            {item.label}
          </text>
        </g>
      ))}
    </g>
  ));
}
