import type { Project, Scene, VideoAsset } from '../shared/types';
import { api } from './api';
import { composeVideoRequest } from './video/compose';
import { renderVideo, type Progress } from './video/render';

/**
 * The tool chain shared by process 1 and the process 3 loop:
 * scripts_n -> [tool_1 compose] -> video_request_n -> [tool_2 execute] -> video_n -> [tool_7 compose] -> video_versions_1
 */
export async function renderAndVersion(scripts: Scene[], onProgress: Progress): Promise<Project> {
  const request = composeVideoRequest(scripts); // tool_1
  const blob = await renderVideo(request, onProgress); // tool_2
  onProgress(1, 'Saving video');
  const file = await api.upload(blob);
  const video: VideoAsset = { id: file.url.split('/').pop()!, url: file.url, mime: file.mime, kind: 'render', request, createdAt: new Date().toISOString() };
  return api.addVersion(video, scripts); // tool_7
}
