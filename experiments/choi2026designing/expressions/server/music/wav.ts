import { readFileSync, writeFileSync } from 'node:fs';

export const SR = 22050;

export function writeWav(path: string, samples: Float32Array, sampleRate = SR) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/** Reads 16-bit PCM WAV (mono or stereo → mono). */
export function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(path);
  let off = 12;
  let channels = 1;
  let sampleRate = SR;
  let bits = 16;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 10);
      sampleRate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Unsupported WAV bit depth ${bits}`);
      const frames = Math.floor(size / 2 / channels);
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += buf.readInt16LE(off + 8 + (i * channels + c) * 2);
        out[i] = s / channels / 32768;
      }
      return { samples: out, sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('No data chunk in WAV');
}
