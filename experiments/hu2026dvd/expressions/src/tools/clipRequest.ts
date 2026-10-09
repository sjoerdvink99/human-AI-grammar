import type { ClipRequest, Scene } from '../../shared/types';

/** tool_1 compose (process 4): clip_scene_1 -> clip_request_1 */
export function composeClipRequest(scene: Scene): ClipRequest {
  return {
    sceneId: scene.id,
    title: scene.title,
    narration: scene.narration,
    onScreenText: scene.onScreenText,
    visual: scene.visual,
    palette: { background: scene.background, accent: scene.accent },
    width: 960,
    height: 540,
    durationSec: scene.durationSec,
  };
}
