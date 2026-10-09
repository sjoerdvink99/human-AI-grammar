/** tool_5 modify: video_1 + object_mask -> cleaned_video (object removed by inpainting). */
import type { ObjectMask } from '../../shared/types';
import { createEncoder } from './encoder';
import { transformVideo } from './frames';

export function polygonBounds(poly: [number, number][]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Rasterise the polygon (normalized) into a W*H mask, dilated by `grow` pixels. */
export function rasterizeMask(poly: [number, number][], W: number, H: number, grow = 4): Uint8Array {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = grow * 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const d = ctx.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  return m;
}

/** Fill masked pixels by blending row-wise and column-wise linear interpolation from the mask border. */
export function inpaintFrame(img: ImageData, mask: Uint8Array) {
  const { width: W, height: H, data } = img;
  const acc = new Float32Array(W * H * 3);
  const cnt = new Uint8Array(W * H);
  const pass = (len: number, lines: number, idx: (line: number, k: number) => number) => {
    for (let l = 0; l < lines; l++) {
      let k = 0;
      while (k < len) {
        if (!mask[idx(l, k)]) { k++; continue; }
        const s = k;
        while (k < len && mask[idx(l, k)]) k++;
        const e = k; // first unmasked after run
        const a = s > 0 ? idx(l, s - 1) : -1;
        const b = e < len ? idx(l, e) : -1;
        if (a < 0 && b < 0) continue;
        for (let j = s; j < e; j++) {
          const f = (j - s + 1) / (e - s + 1);
          const p = idx(l, j);
          for (let ch = 0; ch < 3; ch++) {
            const va = a >= 0 ? data[a * 4 + ch] : data[b * 4 + ch];
            const vb = b >= 0 ? data[b * 4 + ch] : data[a * 4 + ch];
            acc[p * 3 + ch] += va + (vb - va) * f;
          }
          cnt[p]++;
        }
      }
    }
  };
  pass(W, H, (row, k) => row * W + k);
  pass(H, W, (col, k) => k * W + col);
  for (let p = 0; p < W * H; p++) {
    if (!mask[p] || !cnt[p]) continue;
    for (let ch = 0; ch < 3; ch++) data[p * 4 + ch] = acc[p * 3 + ch] / cnt[p];
    data[p * 4 + 3] = 255;
  }
}

export async function removeObject(
  videoUrl: string,
  mask: ObjectMask,
  segment: { start: number; end: number },
  fps: number,
  onProgress: (f: number) => void,
): Promise<Blob> {
  let maskPx: Uint8Array | null = null;
  let enc: Awaited<ReturnType<typeof createEncoder>> | null = null;
  await transformVideo(
    videoUrl,
    fps,
    (ctx, _src, t) => {
      if (t < segment.start || t >= segment.end) return;
      const { width: W, height: H } = ctx.canvas;
      maskPx ??= rasterizeMask(mask.polygon, W, H);
      const img = ctx.getImageData(0, 0, W, H);
      inpaintFrame(img, maskPx);
      ctx.putImageData(img, 0, 0);
    },
    async (canvas, i) => {
      enc ??= await createEncoder(canvas.width, canvas.height, fps);
      await enc.addFrame(canvas, i);
    },
    onProgress,
  );
  if (!enc) throw new Error('Video has no frames');
  return (enc as Awaited<ReturnType<typeof createEncoder>>).finish();
}
