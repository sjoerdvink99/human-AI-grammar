import type { Scene, VideoRequest } from '../../shared/types';

export const VIDEO_W = 960;
export const VIDEO_H = 540;
export const VIDEO_FPS = 24;

/** tool_1 compose: scripts_n* -> video_request_n */
export function composeVideoRequest(scripts: Scene[]): VideoRequest {
  if (!scripts.length) throw new Error('There are no scenes to render.');
  let t = 0;
  const scenes = scripts.map((scene) => {
    const start = t;
    t += Math.max(2, scene.durationSec);
    return { scene, start, end: t };
  });
  return { width: VIDEO_W, height: VIDEO_H, fps: VIDEO_FPS, totalSec: t, scenes };
}

export function sceneAt(req: VideoRequest, time: number) {
  return req.scenes.find((s) => time >= s.start && time < s.end) ?? req.scenes[req.scenes.length - 1];
}
