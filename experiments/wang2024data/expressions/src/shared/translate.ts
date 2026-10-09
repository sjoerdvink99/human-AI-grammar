import { inferType } from './concepts';
import type { Channel, ChartSpec, Concept, ConceptType, Table } from './types';

export type VegaLiteSpec = Record<string, unknown>;

/** Fields a chart_spec refers to, in channel order. */
export function specFields(spec: ChartSpec): string[] {
  const out: string[] = [];
  for (const enc of Object.values(spec.encodings)) if (enc?.field && !out.includes(enc.field)) out.push(enc.field);
  return out;
}

export function isSpecEmpty(spec: ChartSpec): boolean {
  return specFields(spec).length === 0;
}

/**
 * [tool_1 translate]: table + chart_spec -> vega_spec (Vega-Lite).
 * Types come from the concepts when known, otherwise from the data.
 */
export function translateToVegaLite(
  spec: ChartSpec,
  table: Table,
  concepts: Concept[] = [],
  opts: { width?: number; height?: number } = {},
): VegaLiteSpec {
  const typeOf = (field: string): ConceptType =>
    concepts.find((c) => c.name === field && c.source !== 'custom')?.type ??
    inferType(table.rows.map((r) => r[field]));

  const encoding: Record<string, unknown> = {};
  for (const [channel, enc] of Object.entries(spec.encodings) as [Channel, ChartSpec['encodings'][Channel]][]) {
    if (!enc?.field) continue;
    let type: ConceptType = typeOf(enc.field);
    // Shape and facets need discrete values.
    if ((channel === 'shape' || channel === 'column' || channel === 'row') && type === 'quantitative') type = 'ordinal';
    // Rect heatmaps and bars read better with discrete positional axes when the other axis is the measure.
    if (spec.mark === 'rect' && (channel === 'x' || channel === 'y') && type === 'quantitative') type = 'ordinal';
    const def: Record<string, unknown> = { field: enc.field, type };
    if (enc.aggregate && enc.aggregate !== 'none') {
      def.aggregate = enc.aggregate;
      if (enc.aggregate !== 'count') def.type = 'quantitative';
    }
    encoding[channel] = def;
  }

  // A bar chart with a quantitative x and a categorical y should be horizontal; Vega-Lite infers that.
  const mark: Record<string, unknown> = { type: spec.mark, tooltip: true };
  if (spec.mark === 'line' || spec.mark === 'area') mark.point = spec.mark === 'line';

  const faceted = 'column' in encoding || 'row' in encoding;
  const out: VegaLiteSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: table.rows },
    mark,
    encoding,
  };
  if (spec.mark === 'boxplot') out.mark = { type: 'boxplot' };
  out.width = faceted ? Math.round((opts.width ?? 360) / 2) : opts.width ?? 360;
  out.height = faceted ? Math.round((opts.height ?? 260) / 2) : opts.height ?? 260;
  return out;
}
