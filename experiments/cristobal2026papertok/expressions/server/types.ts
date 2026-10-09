// Application state, named after the design's identifiers (without version suffix).

/** (paper_1: artifact language) */
export interface Paper {
  title: string;
  text: string;
  /** relative media path of the uploaded PDF, if any */
  pdfFile?: string;
}

/** (script_options_1: artifact record)*  /  (script_1: artifact record) */
export interface ScriptRecord {
  title: string;
  hook: string;
  body: string;
  closing: string;
  target_seconds: number;
}

/** A version of one item of (scene_scripts: artifact language)* or (visual_prompts: instruction language)* */
export interface Versioned {
  /** current value — scene_scripts_1 / visual_prompts_1 */
  text: string;
  /** earlier values, oldest first (kept for comparison/revert) */
  history: string[];
}

/** One item of (scene_clips_1: artifact multimodal)* plus the intermediate audio/duration/video. */
export interface SceneClip {
  /** (scene_audio: artifact audio) — media path */
  audio: string;
  /** (scene_durations: artifact numeric) — seconds */
  duration: number;
  /** (scene_videos: artifact visual) — silent mp4 */
  video: string;
  /** keyframe still rendered by model_2 */
  still: string;
  /** (scene_clips: artifact multimodal) — mp4 with audio */
  clip: string;
  createdAt: string;
}

export interface Scene {
  script: Versioned;
  visualPrompt: Versioned;
  clip?: SceneClip;
  /** earlier clips replaced by tool_1 modify */
  clipHistory: SceneClip[];
}

/** (regeneration_request_1: instruction categorical) */
export const REGENERATION_REQUESTS = ["new_take", "more_energetic", "calmer"] as const;
export type RegenerationRequest = (typeof REGENERATION_REQUESTS)[number];

/** (merge_request_1: instruction categorical) */
export const MERGE_REQUESTS = ["credit_end", "credit_start"] as const;
export type MergeRequest = (typeof MERGE_REQUESTS)[number];

export interface Project {
  id: string;
  createdAt: string;
  // process 1
  paper?: Paper;
  findings?: string[];
  storyIdeas?: string[];
  hooks?: string[];
  hookRatings?: number[];
  shortlistedHooks?: string[];
  scriptOptions?: ScriptRecord[];
  // process 2 / 3
  script?: ScriptRecord;
  baselineVoiceStyle?: string;
  toneSuggestion?: string;
  tonePreference?: string;
  voiceStyle?: string;
  // process 4–6
  scenes?: Scene[];
  // process 7
  paperScreenshot?: string;
  paperAuthors?: string[];
  creditText?: string;
  creditScene?: string;
  approvedClips?: number[];
  mergeRequest?: MergeRequest;
  creditClip?: string;
  finalVideo?: string;
}
