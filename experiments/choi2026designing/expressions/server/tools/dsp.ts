/** Small DSP helpers shared by the analysis tools. */
export const FRAME = 2048;
export const HOP = 512;

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
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const hann = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));

/** Magnitude spectra for every hop. Calls `fn(frameIndex, magnitudes)`. */
export function stft(x: Float32Array, fn: (f: number, mag: Float64Array) => void) {
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const mag = new Float64Array(FRAME / 2);
  for (let f = 0, s = 0; s + FRAME <= x.length; f++, s += HOP) {
    for (let i = 0; i < FRAME; i++) { re[i] = x[s + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < FRAME / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    fn(f, mag);
  }
}

export function frameRms(x: Float32Array, hop = HOP): Float64Array {
  const n = Math.floor(x.length / hop);
  const out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = 0; i < hop; i++) s += x[f * hop + i] ** 2;
    out[f] = Math.sqrt(s / hop);
  }
  return out;
}

/** Half-wave rectified log spectral flux. */
export function onsetEnvelope(x: Float32Array): Float64Array {
  const frames: number[] = [];
  let prev: Float64Array | null = null;
  stft(x, (_f, mag) => {
    const lm = mag.map((m) => Math.log1p(10 * m));
    let flux = 0;
    if (prev) for (let k = 0; k < lm.length; k++) flux += Math.max(0, lm[k] - prev[k]);
    frames.push(flux);
    prev = lm;
  });
  const env = Float64Array.from(frames);
  const max = Math.max(1e-9, ...env);
  return env.map((v) => v / max);
}

export const downsample = (arr: ArrayLike<number>, points: number) => {
  const out: number[] = [];
  const step = arr.length / points;
  for (let p = 0; p < points; p++) {
    let m = 0;
    for (let i = Math.floor(p * step); i < Math.min(arr.length, Math.floor((p + 1) * step)); i++) m = Math.max(m, arr[i]);
    out.push(m);
  }
  const max = Math.max(1e-9, ...out);
  return out.map((v) => +(v / max).toFixed(3));
};
