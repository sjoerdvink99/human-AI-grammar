import { z } from 'zod';

export interface ChatMessage {
  role: 'companion' | 'client';
  text: string;
  at: number;
}

/** required_variables_1: values extracted from chat_history for each framework variable. */
export type RequiredVariables = Record<string, string | null>;

/** step_status_1: evaluation categorical */
export type StepStatusValue = 'in_progress' | 'step_complete' | 'all_complete';
export interface StepStatus {
  status: StepStatusValue;
  current_step: number;
  missing: string[];
}

export const SongConceptSchema = z.object({
  title: z.string().min(1),
  theme: z.string().min(1),
  emotional_arc: z.string().min(1).describe('How the feeling moves from start to end of the song'),
  perspective: z.string().min(1).describe('Point of view, e.g. first person addressed to my younger self'),
  mood: z.string().min(1),
  message: z.string().min(1).describe('The one thing the song should say'),
});
export type SongConcept = z.infer<typeof SongConceptSchema>;

export const LyricElementsSchema = z.object({
  key_phrases: z.array(z.string()).min(1),
  images: z.array(z.string()),
  metaphors: z.array(z.string()),
  client_words: z.array(z.string()).describe('Exact words or short phrases from the client to keep verbatim'),
});
export type LyricElements = z.infer<typeof LyricElementsSchema>;

export const GENRES = ['acoustic folk', 'pop ballad', 'lo-fi', 'indie rock', 'cinematic', 'soul', 'electronic'] as const;
export const INSTRUMENTS = ['piano', 'guitar', 'strings', 'synth', 'bass', 'drums'] as const;
export const VOICES = ['warm female', 'gentle male', 'bright female', 'soft female', 'deep male'] as const;

export const MusicAttributesSchema = z.object({
  genre: z.enum(GENRES),
  mood: z.string().min(1),
  tempo_bpm: z.number().int().min(50).max(160),
  mode: z.enum(['major', 'minor']),
  instruments: z.array(z.enum(INSTRUMENTS)).min(1),
  voice: z.enum(VOICES),
  energy: z.enum(['calm', 'moderate', 'driving']),
});
export type MusicAttributes = z.infer<typeof MusicAttributesSchema>;

export interface LyricsVersion {
  text: string;
  feedback?: string; // lyrics_feedback that led to the next revision
  at: number;
}

export interface TranscriptWord { word: string; start: number; end: number }
export interface PredictedTranscript {
  engine: string;
  segments: { text: string; start: number; end: number; words: TranscriptWord[] }[];
}
export interface AudioFeatures {
  duration: number;
  sample_rate: number;
  tempo_bpm: number;
  key: string;
  loudness_db: number;
  spectral_centroid_hz: number;
  energy_curve: number[]; // normalised 0..1, fixed number of points across duration
}
export interface TimedLyricLine { line: string; section: string; start: number | null; end: number | null; match_score: number }
export interface TimedLyrics { lines: TimedLyricLine[] }
export interface BeatRow { beat: number; time: number; strength: number; energy: number; downbeat: boolean }

export interface SongVersion {
  version: number;
  music_attributes: MusicAttributes;
  style_prompt: string;
  audio_url: string;
  composition: unknown;
  predicted_transcript: PredictedTranscript;
  audio_features: AudioFeatures;
  timed_lyrics: TimedLyrics;
  beat_features: BeatRow[];
  music_visualization: string; // SVG markup
  song_feedback?: string;
  at: number;
}

export interface Session {
  stage: 'talk' | 'lyrics' | 'music' | 'reflect';
  // Process 1
  chat_history: ChatMessage[];
  required_variables: RequiredVariables;
  step_status: StepStatus;
  question: string | null;
  // Process 2
  lyric_questions: string[] | null;
  lyric_inputs: string | null;
  song_concept: SongConcept | null;
  lyric_elements: LyricElements | null;
  lyrics: LyricsVersion[]; // all rounds of lyrics_1
  lyrics_approved: boolean;
  // Process 3 / 5
  music_guidance: string | null;
  songs: SongVersion[]; // song_1, song_2, …
  // Process 4
  review_question: string | null;
  song_feedback: string | null;
  reflection_question: string | null;
  reflection: string | null;
  supportive_response: string | null;
}
