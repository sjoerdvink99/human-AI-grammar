import { z } from "zod";

// ---------- shared representation types (named after design identifiers) ----------

export interface ChatTurn {
  role: "assistant" | "user";
  text: string;
  at: string;
}

export type RequiredVariables = Record<string, string>;

export type StepStatus = {
  status: "incomplete" | "complete";
  /** index of the framework step the session is on after evaluation */
  currentStep: number;
  completedSteps: string[];
  missing: string[];
  allComplete: boolean;
};

export const SongConceptSchema = z.object({
  title: z.string().min(1).describe("working title of the song"),
  theme: z.string().min(1).describe("the central theme"),
  message: z.string().min(1).describe("what the song should say or make the listener feel"),
  perspective: z.string().min(1).describe("whose voice / point of view, e.g. first person to a younger self"),
  narrative: z.string().min(1).describe("short arc of the song from start to end"),
});
export type SongConcept = z.infer<typeof SongConceptSchema>;

export const LyricElementsSchema = z.object({
  emotions: z.array(z.string()),
  scenes: z.array(z.string()),
  keywords: z.array(z.string()),
  lyric_ideas: z.array(z.string()),
});
export type LyricElements = z.infer<typeof LyricElementsSchema>;

export const GENRES = ["pop", "ballad", "folk", "rock", "r&b", "hip-hop", "electronic", "jazz", "lo-fi"] as const;
export const MOODS = ["hopeful", "calm", "melancholic", "joyful", "empowering", "tender", "angry", "nostalgic"] as const;
export const INSTRUMENTS = ["piano", "acoustic guitar", "synth pad", "strings", "bass", "drums", "bells"] as const;
export const VOCALS = ["soft high voice", "warm low voice", "bright voice", "airy voice"] as const;

export const MusicAttributesSchema = z.object({
  genre: z.enum(GENRES),
  mood: z.enum(MOODS),
  tempo_bpm: z.number().int().min(60).max(160),
  instruments: z.array(z.enum(INSTRUMENTS)).min(1),
  vocal: z.enum(VOCALS),
  notes: z.string().max(400).default(""),
});
export type MusicAttributes = z.infer<typeof MusicAttributesSchema>;

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}
export interface PredictedTranscript {
  words: WordTiming[];
}
export interface AudioFeatures {
  duration: number;
  sampleRate: number;
  key: string;
  mode: "major" | "minor";
  /** per-frame RMS loudness 0..1, frames are frameHop seconds apart */
  loudness: number[];
  /** per-frame spectral centroid normalised 0..1 */
  brightness: number[];
  frameHop: number;
  energy: number;
  averageBrightness: number;
}
export interface TimedLine {
  section: string;
  text: string;
  start: number;
  end: number;
  words: (WordTiming & { matched: boolean })[];
}
export interface TimedLyrics {
  lines: TimedLine[];
  matchRate: number;
}
export interface BeatRow {
  index: number;
  time: number;
  strength: number;
  downbeat: boolean;
}
export interface BeatFeatures {
  tempo: number;
  rows: BeatRow[];
}
export interface MusicVisualization {
  palette: { background: string; primary: string; accent: string; text: string };
  duration: number;
  lines: TimedLine[];
  beats: BeatRow[];
  envelope: { frameHop: number; loudness: number[]; brightness: number[] };
  summary: string[];
}

export interface Song {
  version: number;
  audioUrl: string;
  duration: number;
  stylePrompt: string;
  attributes: MusicAttributes;
  createdAt: string;
  predictedTranscript?: PredictedTranscript;
  audioFeatures?: AudioFeatures;
  timedLyrics?: TimedLyrics;
  beatFeatures?: BeatFeatures;
  musicVisualization?: MusicVisualization;
  songFeedback?: { satisfied: boolean; text: string };
}

export type Phase =
  | "therapy"
  | "lyric_questions"
  | "lyrics_review"
  | "music_attributes"
  | "song_review"
  | "reflection"
  | "revision"
  | "done";

/** Timeline events shown in the conversation column. */
export interface FeedItem {
  kind:
    | "question"
    | "answer"
    | "lyric_questions"
    | "lyric_inputs"
    | "lyrics"
    | "lyrics_feedback"
    | "music_guidance"
    | "music_attributes"
    | "song"
    | "review_question"
    | "song_feedback"
    | "reflection_question"
    | "reflection"
    | "supportive_response"
    | "system";
  role: "assistant" | "user" | "system";
  text: string;
  at: string;
  ref?: number;
}

export interface Session {
  id: string;
  createdAt: string;
  phase: Phase;
  busy: { op: string; label: string } | null;
  error: { message: string; retry: string } | null;
  feed: FeedItem[];
  // process 1
  chatHistory: ChatTurn[];
  requiredVariables: RequiredVariables;
  stepStatus: StepStatus;
  turnsInStep: number;
  // process 2
  lyricQuestions: string[];
  lyricInputs: string | null;
  songConcept: SongConcept | null;
  lyricElements: LyricElements | null;
  lyrics: { version: number; text: string; feedback?: string }[];
  lyricsAccepted: boolean;
  // process 3 / 5
  musicGuidance: string | null;
  musicAttributes: MusicAttributes[];
  stylePrompts: string[];
  songs: Song[];
  // process 4
  reviewQuestion: string | null;
  reflectionQuestion: string | null;
  reflection: string | null;
  supportiveResponse: string | null;
}
