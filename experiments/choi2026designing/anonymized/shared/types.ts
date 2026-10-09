// Representations of the System X design, named after their grammar identifiers (rN).
// The version suffix (_1, _2) is kept as history in the client state rather than in the type names.

/** r1 — instruction record: the brief template that says what the brief must contain. */
export interface BriefField {
  key: string;
  label: string;
  description: string;
  required: boolean;
}
export type BriefTemplate = BriefField[];

/** r2 — artifact language: the user's request, accumulated over the intake loop. */
export interface RequestMessage {
  from: "user" | "assistant";
  text: string;
}

/** r3 — artifact record: the structured brief extracted from r2 according to r1. */
export type Brief = Record<string, string | null>;

/** r4 — evaluation categorical: whether the brief is complete. */
export type BriefStatusValue = "complete" | "incomplete";
export interface BriefStatus {
  status: BriefStatusValue;
  missing: string[];
}

/** r8 — instruction record: the style spec that governs the script. */
export interface StyleSpec {
  tone: string;
  register: "formal" | "neutral" | "casual";
  audienceLevel: "general" | "informed" | "expert";
  targetWords: number;
  mustInclude: string[];
  avoid: string[];
}

/** r9 — artifact record: the outline. */
export interface OutlineSection {
  title: string;
  keyPoints: string[];
  seconds: number;
}
export interface Outline {
  sections: OutlineSection[];
}

/** r13 — instruction record: the voice settings for a take. */
export interface VoiceSettings {
  voice: string;
  rate: number; // words per minute
  pitch: "lower" | "normal" | "higher";
  tone: string;
  pauses: "short" | "medium" | "long";
  emphasisWords: string[];
}

/** r16 — artifact record: voiced segments detected in the audio. */
export interface Segment {
  start: number;
  end: number;
}

/** r17 — artifact record: a pitch and loudness contour. */
export interface ProsodyFrame {
  t: number;
  pitchHz: number | null;
  rmsDb: number;
}

/** r18 — artifact record: the script's words aligned to audio time. */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/** r19 — tabular: per-word delivery features. */
export interface WordFeatureRow {
  index: number;
  word: string;
  start: number;
  end: number;
  duration: number;
  pitchHz: number | null;
  loudnessDb: number;
  pauseAfter: number;
}

/** One take = r13..r20 for one round of process 3 or process 5. */
export interface Take {
  id: string;
  version: number; // _1 from process 3, _2 and later from process 5
  script: string; // r10 the take was recorded from
  voiceSettings: VoiceSettings; // r13
  voiceDirection: string; // r14
  audioUrl: string; // r15
  duration: number;
  segments: Segment[]; // r16
  prosody: ProsodyFrame[]; // r17
  wordTimings: WordTiming[]; // r18
  wordFeatures: WordFeatureRow[]; // r19
  chartSvg: string; // r20
  speechFallback: boolean; // true when the speech model's markup failed validation
  createdAt: string;
}

export const DEFAULT_VOICES = ["Samantha", "Daniel", "Karen", "Moira", "Kathy", "Fred", "Tessa", "Rishi", "Ralph"];
