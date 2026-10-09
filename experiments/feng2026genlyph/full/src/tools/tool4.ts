// tool_4 = rule-based visualization placement recommender
import type { Attribute, LayoutRecommendation, LayoutType, PlacementSettings } from '../types';

export const LAYOUT_LABELS: Record<LayoutType, string> = {
  grid: 'Grid (data order)',
  'sorted-grid': 'Sorted grid',
  grouped: 'Grouped clusters',
  axis: 'Axis (1-D position)',
  scatter: 'Scatter (2-D position)',
  matrix: 'Matrix (category × category)',
  strip: 'Strips (category rows × numeric axis)',
};

/** [tool_4 match] placement_settings_1 + dataset -> layout_recommendation_1 */
export function recommendLayout(settings: PlacementSettings, attrs: Attribute[]): LayoutRecommendation {
  const sel = settings.emphasis
    .slice(0, 2)
    .map((n) => attrs.find((a) => a.name === n))
    .filter((a): a is Attribute => !!a);
  const kinds = sel.map((a) => a.kind);
  const nCat = kinds.filter((k) => k === 'categorical').length;
  const nNum = kinds.length - nCat;
  if (sel.length === 0)
    return { recommended: 'grid', alternatives: ['grid'], rationale: 'No emphasised attribute: glyphs are tiled in data order so each glyph is read on its own.' };
  if (sel.length === 1 && nNum === 1)
    return { recommended: 'axis', alternatives: ['axis', 'sorted-grid'], rationale: `"${sel[0].name}" is numerical: positioning glyphs along an axis makes its magnitude readable; a sorted grid keeps glyphs compact.` };
  if (sel.length === 1)
    return { recommended: 'grouped', alternatives: ['grouped', 'sorted-grid'], rationale: `"${sel[0].name}" is categorical: grouping glyphs into labelled clusters shows category membership and counts.` };
  if (nNum === 2)
    return { recommended: 'scatter', alternatives: ['scatter', 'axis'], rationale: 'Two numerical attributes: a scatter placement encodes both by x and y position.' };
  if (nCat === 2)
    return { recommended: 'matrix', alternatives: ['matrix', 'grouped'], rationale: 'Two categorical attributes: a matrix shows each combination of categories as a cell.' };
  return { recommended: 'strip', alternatives: ['strip', 'grouped', 'axis'], rationale: 'One categorical and one numerical attribute: one strip per category with glyphs positioned by the number.' };
}

/** Axis assignment for a chosen layout: x/y attribute names derived from the emphasis selection. */
export function axesFor(type: LayoutType, settings: PlacementSettings, attrs: Attribute[]): { x: string | null; y: string | null } {
  const sel = settings.emphasis.map((n) => attrs.find((a) => a.name === n)).filter((a): a is Attribute => !!a);
  const num = sel.filter((a) => a.kind === 'numerical');
  const cat = sel.filter((a) => a.kind === 'categorical');
  switch (type) {
    case 'axis': return { x: num[0]?.name ?? null, y: null };
    case 'scatter': return { x: num[0]?.name ?? null, y: num[1]?.name ?? null };
    case 'grouped': return { x: cat[0]?.name ?? sel[0]?.name ?? null, y: null };
    case 'matrix': return { x: cat[0]?.name ?? null, y: cat[1]?.name ?? null };
    case 'strip': return { x: num[0]?.name ?? null, y: cat[0]?.name ?? null };
    case 'sorted-grid': return { x: sel[0]?.name ?? null, y: null };
    default: return { x: null, y: null };
  }
}
