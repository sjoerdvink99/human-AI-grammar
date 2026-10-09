import type { TopLevelSpec } from 'vega-lite';
import type { Channel, Encoding, FieldMeta, FieldType } from '../types';

/** Infer a type for a field name: from r2 if known, otherwise from given table values. */
export type TypeLookup = (name: string) => FieldType | undefined;

export function lookupFromFields(fields: FieldMeta[]): TypeLookup {
  const m = new Map(fields.map((f) => [f.name, f.type]));
  return (n) => m.get(n);
}

/**
 * [tool_1 translate]: r3 (encoding) + field types -> r4 (Vega-Lite spec, data supplied at render time).
 * Returns null when nothing is encoded yet.
 */
export function translateToSpec(encoding: Encoding, typeOf: TypeLookup): TopLevelSpec | null {
  const enc: Record<string, unknown> = {};
  let any = false;
  for (const ch of Object.keys(encoding.channels) as Channel[]) {
    const field = encoding.channels[ch];
    if (!field) continue;
    any = true;
    const type = typeOf(field) ?? 'nominal';
    const agg = encoding.aggregate[ch];
    const def: Record<string, unknown> = { field, type };
    if (agg && agg !== 'none') {
      if (agg === 'count') {
        delete def.field;
        def.aggregate = 'count';
        def.type = 'quantitative';
      } else def.aggregate = agg;
    }
    enc[ch] = def;
  }
  if (!any) return null;
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    data: { name: 'table' },
    mark: { type: encoding.mark, tooltip: true },
    encoding: enc,
    width: encoding.channels.column ? 180 : 'container',
    height: 260,
  } as TopLevelSpec;
}
