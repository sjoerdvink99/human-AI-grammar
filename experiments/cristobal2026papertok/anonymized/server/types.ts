import { z } from "zod";

// r7 / r8: video concept record
export const ConceptSchema = z.object({
  title: z.string().min(1).max(140),
  audience: z.string().min(1).max(200),
  hook: z.string().min(1).max(400),
  tone: z.string().min(1).max(80),
  keyMessage: z.string().min(1).max(400),
  outline: z.array(z.string().min(1).max(300)).min(2).max(10),
  targetSeconds: z.number().int().min(20).max(600),
});
export type Concept = z.infer<typeof ConceptSchema>;

// r5: evaluation of one pitch
export const PitchScoreSchema = z.object({
  faithfulness: z.number().min(1).max(10),
  clarity: z.number().min(1).max(10),
  engagement: z.number().min(1).max(10),
  rationale: z.string().max(400),
});
export type PitchScore = z.infer<typeof PitchScoreSchema> & { total: number };

/** One version of a scene clip (r19 item; r25 / r29 are new versions). */
export interface SceneVersion {
  text: string; // r13 item
  visualPrompt: string; // r14 item
  voice: string; // r15 / r21
  audio: string | null; // r16 / r22 / r26 (URL)
  duration: number | null; // r17 / r23 / r27 (seconds)
  image: string | null; // r18 / r24 / r28 (URL)
  at: string;
}

export interface Scene extends SceneVersion {
  id: string;
  history: SceneVersion[]; // earlier versions, newest last
}

export interface TitleCard {
  frame: string | null; // r30 (URL of a clip image)
  metadata: string[]; // r31*
  text: string; // r32
  image: string | null; // r33 (URL)
}

export interface Busy {
  step: string;
  message: string;
  startedAt: string;
}

export interface Project {
  paper: string; // r1
  keyPoints: string[]; // r2*
  angles: string[]; // r3*
  pitches: string[]; // r4*
  pitchScores: PitchScore[]; // r5*
  shortlist: string[]; // r6*
  concepts: Concept[]; // r7*
  concept: Concept | null; // r8
  clarifyPrompt: string; // r9
  questions: string; // r10
  preferences: string; // r11
  script: string; // r12
  voice: string; // r15
  scenes: Scene[]; // r13* + r14* + r19*
  titleCard: TitleCard | null; // r30..r33
  busy: Busy | null;
  error: string | null;
}

export const emptyProject = (): Project => ({
  paper: "",
  keyPoints: [],
  angles: [],
  pitches: [],
  pitchScores: [],
  shortlist: [],
  concepts: [],
  concept: null,
  clarifyPrompt: "",
  questions: "",
  preferences: "",
  script: "",
  voice: "Samantha",
  scenes: [],
  titleCard: null,
  busy: null,
  error: null,
});
