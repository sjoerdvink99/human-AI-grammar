/** tool_6 compose: cleaned_video + animated_chart (+ chart_region) -> video_with_chart / video_with_shape. */
import { drawChart, type AnimatedChart, type Box } from './chart';
import { createEncoder, type FrameEncoder } from './encoder';
import { transformVideo } from './frames';

export async function composeChart(
  videoUrl: string,
  chart: AnimatedChart,
  region: Box, // normalized
  segment: { start: number; end: number },
  fps: number,
  onProgress: (f: number) => void,
): Promise<Blob> {
  let enc: FrameEncoder | null = null;
  await transformVideo(
    videoUrl,
    fps,
    (ctx, _src, t) => {
      if (t < segment.start || t >= segment.end) return;
      const { width: W, height: H } = ctx.canvas;
      const box = { x: region.x * W, y: region.y * H, w: region.w * W, h: region.h * H };
      const fadeIn = Math.min(1, (t - segment.start) / 0.3);
      ctx.globalAlpha = fadeIn;
      drawChart(ctx, chart, t - segment.start, box);
      ctx.globalAlpha = 1;
    },
    async (canvas, i) => {
      enc ??= await createEncoder(canvas.width, canvas.height, fps);
      await enc.addFrame(canvas, i);
    },
    onProgress,
  );
  if (!enc) throw new Error('Video has no frames');
  return (enc as FrameEncoder).finish();
}
