// Deterministic media tools: tool_1 extract (durations) and tool_2 compose / translate (ffmpeg).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
export const WIDTH = 720;
export const HEIGHT = 1280;
const FPS = 25;

async function ffmpeg(args: string[]) {
  if (!ffmpegPath) throw new Error("ffmpeg binary not available");
  await run(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 24 });
}

/** tool_1 extract: duration in seconds of a PCM WAV file, read from its header. */
export function wavDurationFromBuffer(buf: Buffer): number {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") {
      if (!byteRate) throw new Error("WAV data before fmt chunk");
      const available = Math.min(size, buf.length - off - 8);
      return available / byteRate;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export async function wavDuration(file: string): Promise<number> {
  return wavDurationFromBuffer(await fs.readFile(file));
}

/** Animate a still image (slow zoom) into a silent video of `seconds`. */
export async function stillToVideo(png: string, seconds: number, out: string, zoomIn = true) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const step = (0.12 / frames).toFixed(6);
  const z = zoomIn ? `min(zoom+${step},1.12)` : `if(eq(on,0),1.12,max(zoom-${step},1.0))`;
  await ffmpeg([
    "-i", png,
    "-vf", `scale=${WIDTH * 2}:${HEIGHT * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1,format=yuv420p`,
    "-frames:v", String(frames),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-an", out,
  ]);
}

/** tool_2 compose: scene video + narration audio → scene clip (audio padded to the video length). */
export async function muxClip(video: string, audio: string, seconds: number, out: string) {
  await ffmpeg([
    "-i", video, "-i", audio,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy",
    "-af", "apad,aresample=44100", "-ac", "1", "-c:a", "aac", "-b:a", "128k",
    "-t", seconds.toFixed(3),
    "-movflags", "+faststart",
    out,
  ]);
}

/** tool_2 translate: credit still → silent clip with an audio track so it concatenates cleanly. */
export async function stillToClip(png: string, seconds: number, out: string) {
  const tmp = out.replace(/\.mp4$/, "-v.mp4");
  await stillToVideo(png, seconds, tmp, false);
  await ffmpeg([
    "-i", tmp, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest",
    "-movflags", "+faststart", out,
  ]);
  await fs.rm(tmp, { force: true });
}

/** tool_2 compose: concatenate clips (re-encoded for safety) into the final video. */
export async function concatClips(clips: string[], out: string) {
  if (clips.length === 0) throw new Error("nothing to merge");
  const inputs = clips.flatMap((c) => ["-i", c]);
  const norm = clips
    .map((_, i) => `[${i}:v]scale=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS},format=yuv420p[v${i}];[${i}:a]aresample=44100,aformat=channel_layouts=mono[a${i}];`)
    .join("");
  const pairs = clips.map((_, i) => `[v${i}][a${i}]`).join("");
  await ffmpeg([
    ...inputs,
    "-filter_complex", `${norm}${pairs}concat=n=${clips.length}:v=1:a=1[v][a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", out,
  ]);
}
