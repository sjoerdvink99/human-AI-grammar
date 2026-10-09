// Small DSP helpers shared by the analysis tools.

/** In-place radix-2 FFT. re/im length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();
function hann(n: number) {
  if (!hannCache.has(n)) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return hannCache.get(n)!;
}

/** Magnitude spectrum of a windowed frame starting at `start`. */
export function magnitudeSpectrum(samples: Float32Array, start: number, size: number): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const w = hann(size);
  for (let i = 0; i < size; i++) re[i] = (samples[start + i] ?? 0) * w[i];
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

export function rmsFrames(samples: Float32Array, sampleRate: number, hopSec: number, winSec = hopSec): number[] {
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const win = Math.max(1, Math.round(winSec * sampleRate));
  const out: number[] = [];
  for (let s = 0; s < samples.length; s += hop) {
    let sum = 0;
    let c = 0;
    for (let i = s; i < Math.min(samples.length, s + win); i++, c++) sum += samples[i] * samples[i];
    out.push(Math.sqrt(sum / Math.max(1, c)));
  }
  return out;
}
