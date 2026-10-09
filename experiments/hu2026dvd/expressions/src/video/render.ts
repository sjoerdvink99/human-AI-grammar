import type { VideoRequest } from '../../shared/types';
import { createEncoder } from './encoder';
import { drawTimeline } from './scene';

export type Progress = (fraction: number, label?: string) => void;

/** tool_2 execute: video_request_n -> video_n (encoded blob). */
export async function renderVideo(req: VideoRequest, onProgress: Progress = () => {}): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = req.width;
  canvas.height = req.height;
  const ctx = canvas.getContext('2d')!;
  const enc = await createEncoder(req.width, req.height, req.fps);
  const total = Math.ceil(req.totalSec * req.fps);
  for (let i = 0; i < total; i++) {
    drawTimeline(ctx, req.scenes, i / req.fps, req.width, req.height);
    await enc.addFrame(canvas, i);
    if (i % 12 === 0) onProgress(i / total, 'Rendering frames');
  }
  onProgress(1, 'Finalising');
  return enc.finish();
}
