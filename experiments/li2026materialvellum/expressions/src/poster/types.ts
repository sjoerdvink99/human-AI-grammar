import type { ElementRoleValue, Point } from '../shared/api';
export type { ElementSpec, TextElement, ImageElement, ElementRoleValue } from '../shared/api';

/** (poster_canvas: artifact spatial) */
export interface PosterCanvas { width: number; height: number }

/** (sand_clusters: instruction spatial)* — a closed outline of a heap of sand */
export interface SandCluster { id: string; points: Point[] }

/** (spoken_roles: instruction audio)* — what the person said about one cluster */
export interface SpokenRole {
  clusterId: string;
  /** recorded audio, if a microphone was available */
  audioUrl?: string;
  /** speech-to-text of the recording (or typed fallback when no speech recognition is available) */
  transcript: string;
}

/** (element_roles: label categorical)* */
export interface ElementRole { clusterId: string; role: ElementRoleValue | 'unknown' }
