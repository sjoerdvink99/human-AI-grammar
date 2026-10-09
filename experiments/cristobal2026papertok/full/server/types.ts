// Application state, named after the design's representation identifiers.

export const SCENE_COUNT = 8;
export const OPTION_COUNT = 4;

/** paper: the research paper PDF the researcher uploads */
export interface Paper {
  fileName: string;
  title: string;
  text: string;
  pages: number;
}

/** hooks: attention-grabbing opening lines */
export interface Hook { id: string; text: string }
/** hook_ratings: a score for how engaging each hook is */
export interface HookRating { hookId: string; score: number; reason: string }

/** script_options / script: a hook with an eight-scene script */
export interface ScriptRecord {
  title: string;
  hook: string;
  scenes: string[]; // exactly SCENE_COUNT
}

/** One produced version of a scene clip (scene_clips, replacement_clip, revised_clip). */
export interface ClipVersion {
  version: number;
  origin: 'generate' | 'regenerate' | 'revise';
  sceneScript: string;
  visualPrompt: string;
  audioFile: string;   // scene_audio / replacement_audio / revised_audio
  duration: number;    // scene_durations / replacement_duration / revised_duration
  videoFile: string;   // scene_videos / replacement_video / revised_video
  clipFile: string;    // scene_clips / replacement_clip / revised_clip
  createdAt: string;
}

export interface Scene {
  index: number;
  script: string;          // scene_scripts[i]
  scriptVersion: number;
  visualPrompt: string;    // visual_prompts[i]
  visualPromptVersion: number;
  status: 'idle' | 'working' | 'done' | 'error';
  stage?: string;
  error?: string;
  clips: ClipVersion[];    // all versions, kept for comparison / revert
  activeClip: number | null; // version number of the clip in scene_clips
}

export interface Credits {
  screenshotFile: string;     // paper_screenshot
  authors: string[];          // paper_authors
  creditText: string;         // credit_text (latest version)
  creditTextVersion: number;
  creditSceneFile?: string;   // credit_scene
}

export interface Busy { task: string; stage: string }

export interface Project {
  id: string;
  createdAt: string;
  paper: Paper;
  busy: Busy | null;
  error: string | null;
  // process 1
  findings?: string[];
  storyIdeas?: string[];
  hooks?: Hook[];
  hookRatings?: HookRating[];
  shortlistedHooks?: string[];
  scriptOptions?: ScriptRecord[];
  // process 2 / 3
  selectedOption?: number;
  script?: ScriptRecord;
  originalScript?: ScriptRecord;
  baselineVoiceStyle?: string;
  toneSuggestion?: string;
  tonePreference?: string;
  voiceStyle?: string;
  ttsSettings?: { forVoiceStyle: string; voice: string; rate: number };
  // process 4-6
  storyboardFromScript?: string; // JSON of the script the storyboard was made from
  scenes?: Scene[];
  // process 7
  credits?: Credits;
  approvedClips?: number[];
  creditClipFile?: string;
  finalVideoFile?: string;
}
