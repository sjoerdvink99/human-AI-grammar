// tool_2 evaluate: estimate display energy of a rendering with a linear OLED pixel power model.
// tool_4 / tool_5 evaluate: savings between two energy estimates.
import { PNG } from 'pngjs';

// Relative per-channel cost of a fully lit sub-pixel (blue OLED emitters are least efficient).
export const CHANNEL_COST = { r: 0.27, g: 0.35, b: 0.62 };
// Power of an all-white 1280x800 frame on the reference panel, in milliwatts.
export const FULL_WHITE_MW = 1200;
const STATIC_MW = 80; // panel/driver power independent of content

const LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LUT[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; // sRGB -> linear light
}
const WHITE = CHANNEL_COST.r + CHANNEL_COST.g + CHANNEL_COST.b;

/**
 * @param {Buffer} pngBuffer
 * @returns {{ mW: number, relative: number }} estimated power while showing this page,
 *   averaged over its full height, and the fraction of an all-white screen (0..1)
 */
export function estimateEnergy(pngBuffer) {
  const { data, width, height } = PNG.sync.read(pngBuffer);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += CHANNEL_COST.r * LUT[data[i]] + CHANNEL_COST.g * LUT[data[i + 1]] + CHANNEL_COST.b * LUT[data[i + 2]];
  }
  const relative = sum / (width * height * WHITE);
  return { mW: round(STATIC_MW + relative * FULL_WHITE_MW, 1), relative: round(relative, 4) };
}

/** @returns {{ absoluteMw: number, relative: number }} relative = fraction of `before` saved */
export function computeSavings(before, after) {
  const absoluteMw = before.mW - after.mW;
  return { absoluteMw: round(absoluteMw, 1), relative: round(before.mW ? absoluteMw / before.mW : 0, 4) };
}

function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
