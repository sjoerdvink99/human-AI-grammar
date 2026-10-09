// Model steps (model_1) and the per-scene render chain shared by processes 4, 5 and 6.
import { callJSON, callLLM } from "./providers/llm.ts";
import { synthesizeSpeech } from "./providers/tts.ts";
import { generateVideo } from "./providers/video.ts";
import { wavDuration, muxClip } from "./tools/media.ts";
import { mediaPath, uniqueName } from "./store.ts";
import type { Paper, ScriptRecord, SceneClip, RegenerationRequest } from "./types.ts";

const MODEL_1_SYSTEM = `You are model_1, a science-communication writer who turns research papers into short vertical explainer videos (about 45–90 seconds) for a general audience.
Be accurate to the paper: never invent results, numbers, or claims it does not make.
When asked for JSON, reply with JSON only — no prose, no code fences.`;

const MAX_PAPER_CHARS = 60_000;
function paperBlock(paper: Paper) {
  const text = paper.text.length > MAX_PAPER_CHARS ? paper.text.slice(0, MAX_PAPER_CHARS) + "\n[…truncated]" : paper.text;
  return `<paper title="${paper.title.replace(/"/g, "'")}">\n${text}\n</paper>`;
}

// ---------- validators ----------
export function stringList(min: number, max: number) {
  return (v: unknown): string[] => {
    if (!Array.isArray(v)) throw new Error("expected a JSON array");
    const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
    if (out.length < min) throw new Error(`expected at least ${min} items, got ${out.length}`);
    return out.slice(0, max);
  };
}

export function validateRatings(count: number) {
  return (v: unknown): number[] => {
    if (!Array.isArray(v) || v.length !== count) throw new Error(`expected an array of ${count} numbers`);
    return v.map((x) => {
      const n = Number(typeof x === "object" && x ? (x as { score?: unknown }).score : x);
      if (!Number.isFinite(n)) throw new Error("rating is not a number");
      return Math.max(1, Math.min(10, Math.round(n * 10) / 10));
    });
  };
}

export function validateScript(v: unknown): ScriptRecord {
  const o = v as Record<string, unknown>;
  const str = (k: string) => {
    if (typeof o?.[k] !== "string" || !(o[k] as string).trim()) throw new Error(`script field "${k}" missing`);
    return (o[k] as string).trim();
  };
  const secs = Number(o?.target_seconds);
  return {
    title: str("title"),
    hook: str("hook"),
    body: str("body"),
    closing: str("closing"),
    target_seconds: Number.isFinite(secs) ? Math.max(20, Math.min(180, Math.round(secs))) : 60,
  };
}

// ---------- process 1 ----------
/** [model_1 extract] paper → findings* */
export function extractFindings(paper: Paper) {
  return callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `${paperBlock(paper)}\n\nExtract the 4–8 most important findings of this paper. Each finding is one or two plain-language sentences, specific (include key numbers when the paper reports them). Reply as a JSON array of strings.`,
    },
    stringList(3, 8),
  );
}

/** [model_1 generate]~ paper + findings → story_ideas* */
export function generateStoryIdeas(paper: Paper, findings: string[]) {
  return callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `${paperBlock(paper)}\n\nKey findings:\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nPropose 3–5 distinct story ideas for a short explainer video: each is a narrative angle (e.g. a surprising contrast, an everyday problem the work solves, a "what if"), 1–2 sentences, grounded in the findings. Reply as a JSON array of strings.`,
    },
    stringList(2, 5),
  );
}

/** [model_1 generate]~ paper + story_ideas → hooks* */
export function generateHooks(paper: Paper, storyIdeas: string[]) {
  return callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `${paperBlock(paper)}\n\nStory ideas:\n${storyIdeas.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nWrite 6–10 opening hooks for the video — the first spoken line that makes a viewer stop scrolling. Each at most 25 words, spread across the story ideas, faithful to the paper. Reply as a JSON array of strings.`,
    },
    stringList(4, 10),
  ).then((hooks) => hooks.map((h) => h.replace(/^["“]|["”]$/g, "")));
}

/** [model_1 evaluate] paper + hooks → hook_ratings* (numeric, aligned with hooks) */
export function rateHooks(paper: Paper, hooks: string[]) {
  return callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `${paperBlock(paper)}\n\nRate each hook from 1 to 10 for (a) curiosity / scroll-stopping power, (b) clarity for a general audience and (c) faithfulness to the paper; give one overall score per hook.\nHooks:\n${hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n\nReply as a JSON array of exactly ${hooks.length} numbers, in the same order.`,
    },
    validateRatings(hooks.length),
  );
}

/** [model_1 select] paper + hooks + ratings → shortlisted_hooks* (must be hooks from the list) */
export async function shortlistHooks(paper: Paper, hooks: string[], ratings: number[], k = 3) {
  const indices = await callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `${paperBlock(paper)}\n\nRated hooks:\n${hooks.map((h, i) => `${i + 1}. [${ratings[i]}/10] ${h}`).join("\n")}\n\nSelect the ${k} hooks that would make the strongest videos. Prefer high ratings but also variety of angle. Reply as a JSON array of ${k} hook numbers (1-based).`,
    },
    (v) => {
      if (!Array.isArray(v)) throw new Error("expected array of numbers");
      const idx = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= hooks.length))];
      if (idx.length < Math.min(k, hooks.length)) throw new Error(`expected ${k} distinct valid hook numbers`);
      return idx.slice(0, k);
    },
  );
  return indices.map((i) => hooks[i - 1]);
}

/** [model_1 generate]~ paper + shortlisted_hooks → script_options* (one record per hook) */
export function generateScriptOptions(paper: Paper, shortlisted: string[]) {
  return callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      timeoutMs: 360_000,
      prompt: `${paperBlock(paper)}\n\nShortlisted hooks:\n${shortlisted.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n\nFor each hook write one complete narration script for a 45–90 second vertical video. Spoken, conversational English; short sentences; explain the method and the key result simply; no stage directions.\nReply as a JSON array with one object per hook, in order, each:\n{"title": short video title, "hook": the opening line (may be lightly edited), "body": the main narration (several short paragraphs), "closing": final line / takeaway, "target_seconds": estimated spoken length}`,
    },
    (v) => {
      if (!Array.isArray(v) || v.length === 0) throw new Error("expected a non-empty array of scripts");
      return v.map(validateScript);
    },
  );
}

// ---------- process 2 ----------
function scriptBlock(s: ScriptRecord) {
  return `<script title="${s.title.replace(/"/g, "'")}" target_seconds="${s.target_seconds}">\nHOOK: ${s.hook}\nBODY:\n${s.body}\nCLOSING: ${s.closing}\n</script>`;
}

/** [model_1 generate]~ script + baseline_voice_style → tone_suggestion */
export async function suggestTone(script: ScriptRecord, baseline: string) {
  const out = await callLLM({
    role: "model_1",
    system: MODEL_1_SYSTEM,
    prompt: `${scriptBlock(script)}\n\nBaseline narration style:\n${baseline}\n\nSuggest how the narrator's tone should differ from or refine the baseline for THIS script (emotion, energy, pace, emphasis, voice character). 2–3 sentences, addressed to the creator, as plain text.`,
  });
  return out.trim();
}

/** [model_1 compose]~ script + baseline_voice_style + tone_preference → voice_style */
export async function composeVoiceStyle(script: ScriptRecord, baseline: string, tonePreference: string) {
  const out = await callLLM({
    role: "model_1",
    system: MODEL_1_SYSTEM,
    prompt: `${scriptBlock(script)}\n\nBaseline narration style:\n${baseline}\n\nCreator's tone preference:\n${tonePreference}\n\nCompose the final voice-style instruction for the narrator (text-to-speech). Merge the baseline with the creator's preference; the preference wins on conflicts. Mention voice character (e.g. female/male, accent if requested), energy (e.g. calm or energetic), pace, and emphasis. 2–4 sentences, plain text, no preamble.`,
  });
  return out.trim();
}

// ---------- process 4 / 6 ----------
/** [model_1 decompose] script + voice_style → scene_scripts* */
export function decomposeScript(script: ScriptRecord, voiceStyle: string) {
  return callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `${scriptBlock(script)}\n\nNarration style: ${voiceStyle}\n\nSplit this script into 4–8 scenes for a vertical video. Each scene is the exact narration spoken during that shot (one to three sentences, roughly 5–15 seconds). Keep the wording of the script; together the scenes must cover the hook, body and closing in order. Reply as a JSON array of strings.`,
    },
    stringList(2, 10),
  );
}

const VISUAL_PROMPT_RULES = `A visual prompt describes one vertical (9:16) illustrated shot: subject, composition, colours and mood, concrete and drawable as a flat editorial illustration; 1–3 sentences; no camera jargon; any on-screen text at most 6 words in quotes.`;

/** [model_1 generate]~ scene_scripts + voice_style → visual_prompts* (aligned with scenes) */
export function generateVisualPrompts(scenes: string[], voiceStyle: string) {
  return callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `Scenes of a short explainer video (narration):\n${scenes.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nNarration style: ${voiceStyle}\n\nWrite one visual prompt per scene, with a consistent visual style across scenes. ${VISUAL_PROMPT_RULES}\nReply as a JSON array of exactly ${scenes.length} strings.`,
    },
    (v) => {
      const list = stringList(scenes.length, scenes.length)(v);
      if (list.length !== scenes.length) throw new Error(`expected ${scenes.length} prompts`);
      return list;
    },
  );
}

/** [model_1 generate]~ (process 6) revised scene_scripts_2 + visual_prompts_1 → visual_prompts_2 for one scene */
export async function regenerateVisualPrompt(scenes: string[], prompts: string[], index: number) {
  const out = await callJSON(
    {
      role: "model_1",
      system: MODEL_1_SYSTEM,
      prompt: `Scenes of a short explainer video, with their current visual prompts:\n${scenes
        .map((s, i) => `${i + 1}. NARRATION: ${s}\n   VISUAL: ${prompts[i]}`)
        .join("\n")}\n\nThe narration of scene ${index + 1} was just revised. Write a new visual prompt for scene ${index + 1} that matches its new narration and keeps the visual style of the other scenes. ${VISUAL_PROMPT_RULES}\nReply as a JSON array containing that one string.`,
    },
    stringList(1, 1),
  );
  return out[0];
}

// ---------- per-scene render chain ----------
/**
 * [model_3 generate]~ → [tool_1 extract] → [model_2 generate]~ → [tool_2 compose]
 * for one scene. Returns the new SceneClip (callers decide whether it is new or a replacement).
 */
export async function renderScene(opts: {
  projectId: string;
  index: number;
  sceneScript: string;
  visualPrompt: string;
  voiceStyle: string;
  variation?: RegenerationRequest;
}): Promise<SceneClip & { usedFallback: boolean }> {
  const tag = `scene${opts.index + 1}`;
  const audio = mediaPath(opts.projectId, uniqueName(`${tag}-audio`, "wav"));
  await synthesizeSpeech({ text: opts.sceneScript, voiceStyle: opts.voiceStyle, variation: opts.variation, outFile: audio.file });
  const spoken = await wavDuration(audio.file);
  const duration = Math.round((spoken + 0.4) * 100) / 100; // small breath between scenes
  const still = mediaPath(opts.projectId, uniqueName(`${tag}-still`, "png"));
  const video = mediaPath(opts.projectId, uniqueName(`${tag}-video`, "mp4"));
  const { usedFallback } = await generateVideo({ visualPrompt: opts.visualPrompt, seconds: duration, outStill: still.file, outVideo: video.file });
  const clip = mediaPath(opts.projectId, uniqueName(`${tag}-clip`, "mp4"));
  await muxClip(video.file, audio.file, duration, clip.file);
  return { audio: audio.url, duration, video: video.url, still: still.url, clip: clip.url, createdAt: new Date().toISOString(), usedFallback };
}
