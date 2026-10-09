/**
 * tool_2 in process 7, run in the browser (no ffmpeg needed):
 *   translateTitle: title card visual (r33) + format (r35) -> title clip (r36)
 *   renderVideo:    title clip + chosen clips (r34*) -> final video (r37), recorded with MediaRecorder.
 */
import type { Scene } from "./api.ts";

export type FormatId = "landscape" | "portrait" | "square";
export const FORMATS: Record<FormatId, { w: number; h: number; label: string }> = {
  landscape: { w: 1280, h: 720, label: "16:9 landscape" },
  portrait: { w: 720, h: 1280, label: "9:16 vertical" },
  square: { w: 1080, h: 1080, label: "1:1 square" },
};

export interface Segment {
  image: HTMLImageElement;
  audio: AudioBuffer | null;
  duration: number;
  caption: string | null;
}

const TITLE_SECONDS = 3.5;
const GAP_SECONDS = 0.35;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const svg = await (await fetch(url)).text();
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  img.src = blobUrl;
  await img.decode();
  return img;
}

/** tool_2 translate: r33 -> r36 (a silent clip in the chosen format). */
export async function translateTitle(titleImageUrl: string): Promise<Segment> {
  return { image: await loadImage(titleImageUrl), audio: null, duration: TITLE_SECONDS, caption: null };
}

export async function loadClip(scene: Scene, ctx: BaseAudioContext): Promise<Segment> {
  const [image, audio] = await Promise.all([
    loadImage(scene.image!),
    fetch(scene.audio!).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)),
  ]);
  return { image, audio, duration: audio.duration + GAP_SECONDS, caption: scene.text };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Caption for the part of the narration currently spoken (split by sentence, timed by length). */
function captionAt(caption: string, t: number, duration: number): string {
  const parts = caption.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [caption];
  const total = parts.reduce((a, s) => a + s.length, 0);
  let acc = 0;
  for (const s of parts) {
    acc += s.length;
    if (t <= (acc / total) * (duration - GAP_SECONDS)) return s;
  }
  return parts[parts.length - 1];
}

export function drawFrame(ctx: CanvasRenderingContext2D, seg: Segment, t: number, w: number, h: number) {
  ctx.fillStyle = seg.caption ? "#f7f5ef" : "#1d2440";
  ctx.fillRect(0, 0, w, h);
  const landscape = w / h > 1.5;
  // image area: whole frame for landscape, top part for portrait/square (captions below)
  const areaH = landscape || !seg.caption ? h : w * (9 / 16) + (h - w * (9 / 16)) * 0.25;
  const scale = Math.min(w / seg.image.width, areaH / seg.image.height);
  const iw = seg.image.width * scale;
  const ih = seg.image.height * scale;
  const iy = landscape || !seg.caption ? (h - ih) / 2 : (areaH - ih) / 2 + h * 0.08;
  // gentle Ken Burns zoom on scene images
  const z = seg.caption ? 1 + 0.04 * Math.min(1, t / seg.duration) : 1;
  ctx.save();
  ctx.translate(w / 2, iy + ih / 2);
  ctx.scale(z, z);
  ctx.drawImage(seg.image, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();

  if (!seg.caption) return;
  const text = captionAt(seg.caption, t, seg.duration);
  const fontSize = Math.round(Math.min(w, h) * (landscape ? 0.042 : 0.05));
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const lines = wrapText(ctx, text, w * 0.86).slice(0, 4);
  const lh = fontSize * 1.3;
  const boxH = lines.length * lh + fontSize * 0.8;
  const top = landscape ? h - boxH - h * 0.04 : iy + ih + (h - iy - ih - boxH) / 2;
  if (landscape) {
    ctx.fillStyle = "rgba(13,18,38,0.78)";
    ctx.fillRect(w * 0.05, top, w * 0.9, boxH);
  }
  ctx.fillStyle = landscape ? "#ffffff" : "#1d2440";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + fontSize * 0.4 + i * lh));
}

function pickMime(): { mime: string; ext: string } {
  const options = [
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    { mime: "video/mp4", ext: "mp4" },
  ];
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? { mime: "", ext: "webm" };
}

/** tool_2 compose: segments -> r37 video blob. Real-time; keep the tab visible while it runs. */
export async function renderVideo(
  segments: Segment[],
  format: FormatId,
  audioCtx: AudioContext,
  onProgress: (fraction: number) => void,
): Promise<{ blob: Blob; ext: string }> {
  const { w, h } = FORMATS[format];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  drawFrame(ctx, segments[0], 0, w, h);

  await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const { mime, ext } = pickMime();
  const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

  const starts: number[] = [];
  let acc = 0;
  for (const s of segments) {
    starts.push(acc);
    acc += s.duration;
  }
  const total = acc;

  recorder.start(250);
  const t0 = audioCtx.currentTime + 0.15;
  segments.forEach((s, i) => {
    if (!s.audio) return;
    const src = audioCtx.createBufferSource();
    src.buffer = s.audio;
    src.connect(dest);
    src.start(t0 + starts[i]);
  });

  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = Math.max(0, audioCtx.currentTime - t0);
      if (t >= total) return resolve();
      let i = starts.length - 1;
      while (i > 0 && starts[i] > t) i--;
      drawFrame(ctx, segments[i], t - starts[i], w, h);
      onProgress(t / total);
      setTimeout(tick, 1000 / 30);
    };
    tick();
  });
  recorder.stop();
  await stopped;
  onProgress(1);
  return { blob: new Blob(chunks, { type: mime || `video/${ext}` }), ext };
}
