/** Frame access for existing videos (used by keyframe picking, tool_5 and tool_6). */

export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error(`Could not load video ${url}`));
  });
  return v;
}

export function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.001));
    if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2) return resolve();
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = target;
  });
}

/** Grab the frame at time t as a canvas. */
export async function grabFrame(v: HTMLVideoElement, t: number): Promise<HTMLCanvasElement> {
  await seek(v, t);
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d')!.drawImage(v, 0, 0);
  return c;
}

/**
 * Walk every frame of a video at `fps`, letting `draw` paint the output frame.
 * Used by tool_5 (object removal) and tool_6 (chart composition).
 */
export async function transformVideo(
  url: string,
  fps: number,
  draw: (ctx: CanvasRenderingContext2D, source: HTMLVideoElement, t: number) => void,
  encode: (canvas: HTMLCanvasElement, index: number) => Promise<void>,
  onProgress: (f: number) => void,
) {
  const v = await loadVideo(url);
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const total = Math.floor(v.duration * fps);
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    await seek(v, t + 0.5 / fps);
    ctx.drawImage(v, 0, 0);
    draw(ctx, v, t);
    await encode(canvas, i);
    if (i % 6 === 0) onProgress(i / total);
  }
  onProgress(1);
  return { width: canvas.width, height: canvas.height };
}
