import type { z } from 'zod';
import type { SceneSchema, VisualSchema } from './schemas';

export type Visual = z.infer<typeof VisualSchema>;
/** scripts_n: artifact record (one item of the collection). */
export type Scene = z.infer<typeof SceneSchema>;

/** guidelines_1: artifact language */
export interface Guideline { id: string; title: string; text: string }

/** reference_videos_1: artifact visual. Seeded entries carry a script rendered live; uploads carry a url. */
export interface ReferenceVideo {
  id: string;
  title: string;
  description: string;
  tags: string[];
  scenes?: Scene[];
  url?: string;
}

/** video_request_n: instruction record (tool_1 compose output). */
export interface VideoRequest {
  width: number;
  height: number;
  fps: number;
  totalSec: number;
  scenes: { scene: Scene; start: number; end: number }[];
}

/** video_n / cleaned_video / video_with_chart …: artifact visual. */
export interface VideoAsset {
  id: string;
  url: string;
  mime: string;
  kind: 'render' | 'cleaned_full' | 'cleaned_shape' | 'with_chart' | 'with_shape';
  request: VideoRequest;
  createdAt: string;
  /** For cleaned videos: the region (normalized) the object was removed from, and the time segment edited. */
  removedRegion?: { x: number; y: number; w: number; h: number };
  segment?: { start: number; end: number };
  /** Short human-readable note, e.g. which object was removed. */
  note?: string;
}

/** object_mask_*: selection spatial, polygon in normalized coordinates. */
export interface ObjectMask { polygon: [number, number][]; objectName: string }

/** video_versions_1: artifact visual* (tool_7 compose output). */
export interface VideoVersion {
  id: string;
  number: number;
  video: VideoAsset;
  scripts: Scene[];
  createdAt: string;
  /** assessment_1 (process 3) */
  assessment?: string;
  /** video_assessment_1 (process 8) */
  review?: string;
}

export type ChartType = 'bar' | 'line' | 'pie' | 'race';
export const CHART_TYPES: ChartType[] = ['bar', 'line', 'pie', 'race'];

/** chart_data_1: artifact tabular. First column = category, other columns numeric series. */
export interface ChartData { columns: string[]; rows: (string | number)[][] }

/** clip_request_1: instruction record */
export interface ClipRequest {
  sceneId: string;
  title: string;
  narration: string;
  onScreenText: string;
  visual: Visual;
  palette: { background: string; accent: string };
  width: number;
  height: number;
  durationSec: number;
}

export interface Project {
  topic: string;
  dataFacts: string[];
  guidelines: Guideline[];
  scripts: Scene[];
  references: ReferenceVideo[];
  versions: VideoVersion[];
  currentVersionId?: string;
  chartData: ChartData;
  chartType?: ChartType;
  composites: VideoAsset[];
}
