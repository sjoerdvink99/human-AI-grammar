/**
 * Shared chain of process 3 and process 5, from music_attributes onward:
 * [model_1 translate]~ → [model_2 generate]~ → [tool_2 extract] → [tool_3 match] → [tool_4 extract] → [tool_5 translate]
 */
import { translateToStylePrompt } from './steps.ts';
import { generateSong } from './music/generateSong.ts';
import { readWav } from './music/wav.ts';
import { transcribe } from './tools/transcribe.ts';
import { extractAudioFeatures } from './tools/audioFeatures.ts';
import { alignLyrics } from './tools/alignLyrics.ts';
import { extractBeats } from './tools/beats.ts';
import { renderVisualization } from './tools/visualize.ts';
import type { MusicAttributes, SongVersion } from './types.ts';

export async function runSongPipeline(
  lyrics: string, attrs: MusicAttributes, version: number, audioDir: string,
  progress: (msg: string) => void = () => {},
): Promise<SongVersion> {
  progress('Translating your choices into a style prompt…');
  const style_prompt = await translateToStylePrompt(lyrics, attrs); // model_1 translate~

  progress('Composing and recording the song…');
  const song = await generateSong(lyrics, style_prompt, audioDir, `song_${version}`); // model_2 generate~

  progress('Listening back: transcript and audio features…');
  const mix = readWav(song.mixPath);
  const vocals = readWav(song.vocalsPath);
  const predicted_transcript = transcribe({ vocals: vocals.samples, sampleRate: vocals.sampleRate, engineLines: song.sung.map((s) => s.text) }); // tool_2
  const audio_features = extractAudioFeatures(mix.samples, mix.sampleRate); // tool_2

  progress('Aligning lyrics and beats…');
  const timed_lyrics = alignLyrics(lyrics, predicted_transcript); // tool_3 match
  const beat_features = extractBeats(mix.samples, mix.sampleRate); // tool_4 extract

  const music_visualization = renderVisualization(timed_lyrics, audio_features, beat_features); // tool_5 translate

  return {
    version, music_attributes: attrs, style_prompt,
    audio_url: `/api/audio/song_${version}.wav`,
    composition: song.composition,
    predicted_transcript, audio_features, timed_lyrics, beat_features, music_visualization,
    at: Date.now(),
  };
}

/** A textual stand-in for "listening" so model_1 can talk about song + music_visualization. */
export function describeSong(s: SongVersion): string {
  const f = s.audio_features;
  const curve = f.energy_curve;
  const third = Math.floor(curve.length / 3);
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
  return [
    `Style: ${s.style_prompt}`,
    `Duration ${Math.round(f.duration)}s, measured tempo ≈ ${f.tempo_bpm} bpm, key ≈ ${f.key}.`,
    `Energy by thirds (0–1): ${avg(curve.slice(0, third))}, ${avg(curve.slice(third, 2 * third))}, ${avg(curve.slice(2 * third))}.`,
    `Sections in order: ${[...new Set(s.timed_lyrics.lines.map((l) => l.section))].join(' → ')}.`,
  ].join('\n');
}
