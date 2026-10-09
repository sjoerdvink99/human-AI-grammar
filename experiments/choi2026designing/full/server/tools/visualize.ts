// tool_5 translate — visual rendering.
// song + timed_lyrics + audio_features + beat_features -> music_visualization
// Produces a render specification (palette, timed lyric lines, beat pulses,
// loudness/brightness envelope) that the client draws on an animated canvas
// in sync with playback.
import type { AudioFeatures, BeatFeatures, MusicVisualization, TimedLyrics } from "../types.ts";

// position on the circle of fifths -> hue, so related keys get related colours
const FIFTHS = ["C", "G", "D", "A", "E", "B", "F#", "C#", "Ab", "Eb", "Bb", "F"];

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

export function renderVisualization(
  duration: number,
  timedLyrics: TimedLyrics,
  audioFeatures: AudioFeatures,
  beatFeatures: BeatFeatures,
): MusicVisualization {
  const hue = (FIFTHS.indexOf(audioFeatures.key) / 12) * 360;
  const minor = audioFeatures.mode === "minor";
  const sat = 45 + audioFeatures.energy * 45;
  const palette = {
    background: hsl(hue, minor ? 35 : 45, minor ? 9 : 13),
    primary: hsl(hue, sat, minor ? 58 : 64),
    accent: hsl((hue + 150) % 360, sat, 62),
    text: "hsl(0 0% 96%)",
  };
  const energyWord = audioFeatures.energy > 0.55 ? "strong and full" : audioFeatures.energy > 0.35 ? "moderate" : "gentle and soft";
  const brightWord = audioFeatures.averageBrightness > 0.4 ? "bright" : audioFeatures.averageBrightness > 0.2 ? "warm" : "dark and mellow";
  const summary = [
    `Tempo about ${Math.round(beatFeatures.tempo)} beats per minute (${beatFeatures.tempo < 85 ? "slow" : beatFeatures.tempo < 120 ? "medium" : "fast"})`,
    `Key ${audioFeatures.key} ${audioFeatures.mode}${minor ? " — often feels more serious or wistful" : " — often feels open or uplifting"}`,
    `Overall energy is ${energyWord}; the sound colour is ${brightWord}`,
    `${timedLyrics.lines.length} sung lines, ${beatFeatures.rows.length} beats, ${Math.round(duration)} seconds`,
  ];
  return {
    palette,
    duration,
    lines: timedLyrics.lines,
    beats: beatFeatures.rows,
    envelope: { frameHop: audioFeatures.frameHop, loudness: audioFeatures.loudness, brightness: audioFeatures.brightness },
    summary,
  };
}
