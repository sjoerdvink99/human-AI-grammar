import type { ChartSpec, Concept, ConceptType, Row } from './types';
import { columnValues, inferType } from './concepts';

/**
 * [tool_1 translate]: chart_spec (+ table, concepts) -> vega_spec.
 * The data is embedded as-is; no aggregation or transformation is added.
 */
export function toVegaLite(
  spec: ChartSpec,
  rows: Row[],
  concepts: Concept[],
  opts: { width?: number; height?: number } = {},
): Record<string, unknown> {
  const encoding: Record<string, unknown> = {};
  for (const [channel, field] of Object.entries(spec.encodings)) {
    if (!field) continue;
    const type: ConceptType =
      concepts.find((c) => c.name === field)?.type ?? inferType(columnValues(rows, field));
    const enc: Record<string, unknown> = { field, type };
    // Rect (heatmap) and bar positional channels read better as discrete when not numeric.
    if ((channel === 'x' || channel === 'y') && spec.mark === 'rect' && type === 'quantitative') {
      enc.type = 'ordinal';
    }
    if (channel === 'column') enc.type = type === 'quantitative' ? 'ordinal' : type;
    if (channel === 'shape' && type === 'quantitative') enc.type = 'nominal';
    encoding[channel] = enc;
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: opts.width ?? 360,
    height: opts.height ?? 260,
    data: { values: rows },
    mark: { type: spec.mark, tooltip: true, ...(spec.mark === 'line' ? { point: rows.length <= 60 } : {}) },
    encoding,
  };
}

/** Concepts required by a chart spec. */
export function specFields(spec: ChartSpec): string[] {
  return [...new Set(Object.values(spec.encodings).filter((f): f is string => !!f))];
}
