// tool_3 modify: deterministic, rule-based energy edits applied to training pages.
// The same strategy ids are the dimensions of optimizer_weights and are named in model_2's prompt.

export const STRATEGIES = [
  {
    id: 'dark_color_scheme',
    description: 'Switch to a dark colour scheme: near-black page and surface backgrounds, light text, keep accent hues.',
    htmlFilter: 'invert(1) hue-rotate(180deg)',
    mediaFilter: 'invert(1) hue-rotate(180deg)',
  },
  {
    id: 'black_page_background',
    description: 'Make the root page background true black (#000) instead of white or grey.',
    css: 'html,body{background-color:#000 !important;color:#e6e6e6 !important}',
  },
  {
    id: 'remove_background_images',
    description: 'Remove decorative background images and large gradients; use flat dark fills instead.',
    css: '*{background-image:none !important}',
  },
  {
    id: 'dim_media',
    description: 'Dim photos, videos and large illustrations (e.g. brightness 70-80%).',
    mediaFilter: 'brightness(0.75)',
  },
  {
    id: 'reduce_blue',
    description: 'Shift colours away from blue/white toward warmer, lower-blue tones (blue sub-pixels cost the most).',
    htmlFilter: 'sepia(0.3)',
  },
  {
    id: 'lower_brightness',
    description: 'Lower overall luminance of light surfaces, e.g. #fff -> #e0e0e0 or darker.',
    htmlFilter: 'brightness(0.85)',
  },
  {
    id: 'desaturate',
    description: 'Reduce saturation of large coloured areas (banners, buttons, cards).',
    htmlFilter: 'saturate(0.6)',
  },
];

export const STRATEGY_IDS = STRATEGIES.map((s) => s.id);

/** Inject the CSS for a set of strategy ids into an HTML document. */
export function applyStrategies(html, ids) {
  const chosen = STRATEGIES.filter((s) => ids.includes(s.id));
  const htmlFilters = chosen.filter((s) => s.htmlFilter).map((s) => s.htmlFilter);
  // Media inside a filtered <html> inherits its filter; re-apply the inverse where needed.
  const mediaFilters = chosen.filter((s) => s.mediaFilter).map((s) => s.mediaFilter);
  const rules = chosen.filter((s) => s.css).map((s) => s.css);
  if (htmlFilters.length) rules.push(`html{filter:${htmlFilters.join(' ')} !important}`);
  if (mediaFilters.length) rules.push(`img,video,picture,canvas{filter:${mediaFilters.join(' ')} !important}`);
  const style = `<style data-energy-strategies="${ids.join(' ')}">${rules.join('\n')}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
  return style + html;
}

/** One single-strategy variant per strategy plus `extra` random 2-3 strategy combinations. */
export function variantPlans(rand = Math.random, extra = 3) {
  const plans = STRATEGY_IDS.map((id) => [id]);
  for (let k = 0; k < extra; k++) {
    const n = 2 + Math.floor(rand() * 2);
    const pool = [...STRATEGY_IDS];
    const pick = [];
    while (pick.length < n) pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    plans.push(pick);
  }
  return plans;
}
