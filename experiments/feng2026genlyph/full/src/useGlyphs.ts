import { useMemo } from 'react';
import { useStore } from './store';
import { composeGlyphs, translateNumerical } from './tools/tool3';
import type { GlyphSet } from './types';

/** glyphs_1* — recomposed deterministically whenever an input of process 6 changes */
export function useGlyphs(): GlyphSet | null {
  const { s } = useStore();
  return useMemo(() => {
    if (!s.glyphImage || !s.dataset || !s.assembly) return null;
    const numerical = translateNumerical(s.glyphImage, s.dataset, s.attributes, s.mappings, s.contours, s.assembly);
    return composeGlyphs(s.glyphImage, s.dataset, s.masks, s.mappings, s.fragments, s.categoricalFragments, numerical, s.contours, s.assembly);
  }, [s.glyphImage, s.dataset, s.attributes, s.mappings, s.contours, s.assembly, s.masks, s.fragments, s.categoricalFragments]);
}
