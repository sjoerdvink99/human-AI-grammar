/** Vocal rendering with the macOS speech synthesizer (`say` + `afconvert`). */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWav, SR } from './wav.ts';

const run = promisify(execFile);

export async function renderVocalLine(text: string, voice: string, wordsPerMinute: number): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), 'vox-'));
  try {
    const aiff = join(dir, 'l.aiff');
    const wav = join(dir, 'l.wav');
    const rate = String(Math.round(Math.max(90, Math.min(260, wordsPerMinute))));
    try {
      await run('say', ['-v', voice, '-r', rate, '-o', aiff, text]);
    } catch {
      await run('say', ['-r', rate, '-o', aiff, text]); // voice not installed → default voice
    }
    await run('afconvert', ['-f', 'WAVE', '-d', `LEI16@${SR}`, '-c', '1', aiff, wav]);
    return readWav(wav).samples;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
