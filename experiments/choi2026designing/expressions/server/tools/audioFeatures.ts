/** tool_2 extract (part 2): song → audio_features. */
import type { AudioFeatures } from '../types.ts';
import { downsample, FRAME, frameRms, onsetEnvelope, stft } from './dsp.ts';
import { estimateTempo } from './beats.ts';

const PITCHES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db + 1e-12);
}

export function extractAudioFeatures(x: Float32Array, sampleRate: number): AudioFeatures {
  const chroma = new Array(12).fill(0);
  let centroidSum = 0, centroidN = 0;
  stft(x, (_f, mag) => {
    let num = 0, den = 0;
    for (let k = 1; k < mag.length; k++) {
      const hz = (k * sampleRate) / FRAME;
      num += hz * mag[k]; den += mag[k];
      if (hz > 60 && hz < 2000) {
        const pc = ((Math.round(12 * Math.log2(hz / 440)) + 9) % 12 + 12) % 12;
        chroma[pc] += mag[k] ** 2;
      }
    }
    if (den > 1e-6) { centroidSum += num / den; centroidN++; }
  });
  let best = { score: -Infinity, key: 'C major' };
  for (let r = 0; r < 12; r++) {
    const rot = chroma.slice(r).concat(chroma.slice(0, r));
    const maj = corr(rot, KS_MAJOR), min = corr(rot, KS_MINOR);
    if (maj > best.score) best = { score: maj, key: `${PITCHES[r]} major` };
    if (min > best.score) best = { score: min, key: `${PITCHES[r]} minor` };
  }
  const rms = frameRms(x);
  const meanSq = x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length);
  return {
    duration: +(x.length / sampleRate).toFixed(2),
    sample_rate: sampleRate,
    tempo_bpm: Math.round(estimateTempo(onsetEnvelope(x), sampleRate)),
    key: best.key,
    loudness_db: +(10 * Math.log10(meanSq + 1e-12)).toFixed(1),
    spectral_centroid_hz: Math.round(centroidSum / Math.max(1, centroidN)),
    energy_curve: downsample(rms, 300),
  };
}
