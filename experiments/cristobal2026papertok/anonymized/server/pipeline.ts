/** Model_1 steps and the process orchestration (processes 1, 2, 4, 5, 6, 7-server-part). */
import { z } from "zod";
import { callModel, callModelJSON, generateImage, synthesizeSpeech } from "./provider.ts";
import { ConceptSchema, PitchScoreSchema, type Concept, type PitchScore, type Scene, type SceneVersion } from "./types.ts";
import { wavDuration } from "./tools.ts";
import { putMedia } from "./store.ts";

const PAPER_LIMIT = 60_000;
const paperBlock = (paper: string) =>
  `<document>\n${paper.length > PAPER_LIMIT ? paper.slice(0, PAPER_LIMIT) + "\n[...truncated]" : paper}\n</document>`;
const list = (items: string[]) => items.map((s, i) => `${i + 1}. ${s}`).join("\n");

const ANALYST =
  "You help turn a research paper or long document into a short narrated explainer video. Stay faithful to the document; never invent results.";

// ---------------- process 1 ----------------

/** [model_1 extract] r1 -> r2* */
export async function extractKeyPoints(paper: string): Promise<string[]> {
  const r = await callModelJSON(
    {
      system: ANALYST,
      prompt: `${paperBlock(paper)}\n\nExtract the 5 to 8 most important points of this document (problem, approach, key findings, implications). Each point is one self-contained sentence.\nReturn {"keyPoints": string[]}.`,
    },
    z.object({ keyPoints: z.array(z.string().min(5)).min(3).max(10) }),
  );
  return r.keyPoints;
}

/** [model_1 generate]~ r1 + r2* -> r3* */
export async function generateAngles(paper: string, keyPoints: string[]): Promise<string[]> {
  const r = await callModelJSON(
    {
      system: ANALYST,
      prompt: `${paperBlock(paper)}\n\nKey points:\n${list(keyPoints)}\n\nPropose 6 distinct story angles for a 1–3 minute explainer video about this document. Each angle names a target audience and the question or tension the video is built around, in one or two sentences. Make them genuinely different (e.g. general public vs. practitioners, "why it matters" vs. "how it works").\nReturn {"angles": string[]}.`,
    },
    z.object({ angles: z.array(z.string().min(5)).min(3).max(8) }),
  );
  return r.angles;
}

/** [model_1 generate]~ r1 + r3* -> r4* */
export async function generatePitches(paper: string, angles: string[]): Promise<string[]> {
  const r = await callModelJSON(
    {
      system: ANALYST,
      prompt: `${paperBlock(paper)}\n\nStory angles:\n${list(angles)}\n\nFor each angle, in the same order, write a pitch for the video: 3–4 sentences covering the opening hook, what the viewer learns, and how it ends.\nReturn {"pitches": string[]} with exactly ${angles.length} items.`,
    },
    z.object({ pitches: z.array(z.string().min(10)).length(angles.length) }),
  );
  return r.pitches;
}

/** [model_1 evaluate] r1 + r4* -> r5* */
export async function evaluatePitches(paper: string, pitches: string[]): Promise<PitchScore[]> {
  const r = await callModelJSON(
    {
      system: ANALYST + " You are a strict reviewer.",
      prompt: `${paperBlock(paper)}\n\nVideo pitches:\n${list(pitches)}\n\nScore every pitch from 1 to 10 on: faithfulness (claims supported by the document), clarity (easy to follow for its audience), engagement (would people watch to the end). Add a one-sentence rationale.\nReturn {"scores": [{"faithfulness": n, "clarity": n, "engagement": n, "rationale": string}]} with exactly ${pitches.length} items in pitch order.`,
    },
    z.object({ scores: z.array(PitchScoreSchema).length(pitches.length) }),
  );
  return r.scores.map((s) => ({
    ...s,
    total: Math.round(((s.faithfulness * 2 + s.clarity + s.engagement) / 4) * 10) / 10,
  }));
}

/** [model_1 select] r1 + r4* + r5* -> r6* */
export async function selectPitches(paper: string, pitches: string[], scores: PitchScore[], k = 3): Promise<string[]> {
  const n = Math.min(k, pitches.length);
  const r = await callModelJSON(
    {
      system: ANALYST,
      prompt: `${paperBlock(paper)}\n\nPitches with review scores:\n${pitches
        .map(
          (p, i) =>
            `${i + 1}. ${p}\n   faithfulness ${scores[i].faithfulness}, clarity ${scores[i].clarity}, engagement ${scores[i].engagement} — ${scores[i].rationale}`,
        )
        .join("\n")}\n\nChoose the ${n} pitches that together give the creator the best and most varied options (prefer high scores, avoid near-duplicates).\nReturn {"selected": number[]} with ${n} distinct 1-based pitch numbers.`,
    },
    z.object({
      selected: z
        .array(z.number().int().min(1).max(pitches.length))
        .length(n)
        .refine((a) => new Set(a).size === a.length, "numbers must be distinct"),
    }),
  );
  return r.selected.map((i) => pitches[i - 1]);
}

/** [model_1 generate]~ r1 + r6* -> r7* */
export async function generateConcepts(paper: string, shortlist: string[]): Promise<Concept[]> {
  const r = await callModelJSON(
    {
      system: ANALYST,
      prompt: `${paperBlock(paper)}\n\nShortlisted pitches:\n${list(shortlist)}\n\nTurn each pitch into a video concept record. Return {"concepts": [{"title": string, "audience": string, "hook": string (the opening line), "tone": string (2-4 words), "keyMessage": string (one sentence), "outline": string[] (4-7 beats), "targetSeconds": integer between 45 and 180}]} with exactly ${shortlist.length} items in order.`,
    },
    z.object({ concepts: z.array(ConceptSchema).length(shortlist.length) }),
  );
  return r.concepts;
}

// ---------------- process 2 ----------------

/** [model_1 generate]~ r8 + r9 -> r10 */
export async function generateQuestions(concept: Concept, clarifyPrompt: string): Promise<string[]> {
  const r = await callModelJSON(
    {
      system: "You are a script editor preparing to write an explainer video narration.",
      prompt: `${clarifyPrompt}\n\n(Concept record: ${JSON.stringify(concept)})\n\nReturn {"questions": string[]} with 3 to 5 short questions for the creator.`,
    },
    z.object({ questions: z.array(z.string().min(5).max(300)).min(2).max(6) }),
  );
  return r.questions;
}

/** [model_1 compose]~ r8 + r9 + r11 -> r12 */
export async function composeScript(concept: Concept, clarifyPrompt: string, preferences: string): Promise<string> {
  const words = Math.round(concept.targetSeconds * 2.4);
  const text = await callModel({
    system:
      "You are a script writer for short narrated explainer videos. You write only the spoken narration: plain sentences, no headings, no stage directions, no speaker labels, no markdown.",
    prompt: `${clarifyPrompt}\n\nThe creator's answers and preferences:\n${preferences || "(none given)"}\n\nNow write the full narration script for this concept. Follow the outline in order, open with the hook, and close with the key message. About ${words} words (≈${concept.targetSeconds} seconds spoken). Separate the beats with blank lines.`,
  });
  const script = text.replace(/^```[a-z]*\n?|```$/g, "").trim();
  if (script.split(/\s+/).length < 20) throw new Error("Script too short; try again");
  return script;
}

// ---------------- process 4 ----------------

/** [model_1 decompose] r8 + r12 -> r13* */
export async function decomposeScript(concept: Concept, script: string): Promise<string[]> {
  const r = await callModelJSON(
    {
      system: "You split narration scripts into scenes for a slideshow-style explainer video.",
      prompt: `Video: ${concept.title} (${concept.tone}, for ${concept.audience}).\n\nScript:\n"""\n${script}\n"""\n\nSplit the script into consecutive scenes of 1–3 sentences each (about 8–20 seconds of speech), each showing one idea. Use the script's wording verbatim; every sentence must appear exactly once, in order.\nReturn {"scenes": string[]}.`,
    },
    z.object({ scenes: z.array(z.string().min(3)).min(2).max(30) }),
  );
  // validation: scenes must cover the script (allowing whitespace differences)
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const joined = norm(r.scenes.join(" "));
  const original = norm(script);
  if (Math.abs(joined.length - original.length) > original.length * 0.15) {
    throw new Error("Scene split does not match the script (text was added or dropped); try again");
  }
  return r.scenes.map((s) => s.trim());
}

const VISUAL_SYSTEM =
  "You are an art director. For each narration scene you describe one illustration for a flat infographic-style explainer video: what is drawn, layout, up to 4 short labels. Concrete and drawable with simple shapes; no photographs or real people's faces.";

/** [model_1 generate]~ r13* + r12 -> r14* */
export async function generateVisualPrompts(scenes: string[], script: string): Promise<string[]> {
  const r = await callModelJSON(
    {
      system: VISUAL_SYSTEM,
      prompt: `Full script for context:\n"""\n${script}\n"""\n\nScenes:\n${list(scenes)}\n\nWrite one visual description (2–3 sentences) per scene, keeping a consistent visual language across scenes.\nReturn {"prompts": string[]} with exactly ${scenes.length} items.`,
    },
    z.object({ prompts: z.array(z.string().min(10)).length(scenes.length) }),
  );
  return r.prompts;
}

/** [model_1 generate]~ (process 6) r13_2* + r14_1* + r12 -> r14_2* : rewrites the prompt of the edited scene. */
export async function regenerateVisualPrompt(scenes: string[], prompts: string[], index: number, script: string): Promise<string[]> {
  const r = await callModelJSON(
    {
      system: VISUAL_SYSTEM,
      prompt: `Full script for context:\n"""\n${script}\n"""\n\nScenes with their current visual descriptions:\n${scenes
        .map((s, i) => `${i + 1}. NARRATION: ${s}\n   VISUAL: ${prompts[i]}`)
        .join("\n")}\n\nThe narration of scene ${index + 1} was just edited by the creator. Write a new visual description for scene ${index + 1} that fits its new narration and the visual language of the others.\nReturn {"prompt": string}.`,
    },
    z.object({ prompt: z.string().min(10) }),
  );
  return prompts.map((p, i) => (i === index ? r.prompt : p));
}

export const IMAGE_STYLE =
  "flat vector infographic, light warm-white background (#f7f5ef), navy (#1d2440) outlines and text, accent colours teal (#1f9e89) and coral (#e8684a), generous whitespace";

/** model_3 generate + tool_1 extract: narration -> audio file + duration */
export async function voiceScene(text: string, voice: string): Promise<{ audio: string; duration: number }> {
  const wav = await synthesizeSpeech(text, voice);
  const duration = wavDuration(wav);
  const audio = await putMedia(wav, "wav");
  return { audio, duration };
}

/** model_2 generate: visual prompt -> image file */
export async function drawScene(visualPrompt: string): Promise<string> {
  const svg = await generateImage(visualPrompt, IMAGE_STYLE);
  return putMedia(svg, "svg");
}

/** tool_2 compose: pieces -> one clip (r19 item / r25 / r29). */
export function composeClip(base: Scene, v: Omit<SceneVersion, "at">): Scene {
  const { history, id, ...prev } = base;
  const hadMedia = prev.audio || prev.image;
  return {
    id,
    ...v,
    at: new Date().toISOString(),
    history: hadMedia ? [...history, prev] : history,
  };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
