// model_1 operations — one prompt per grammar operation, built only from the representations
// present in the state that precedes the operation.
import type {
  Brief,
  BriefStatus,
  BriefTemplate,
  Outline,
  StyleSpec,
  VoiceSettings,
  WordFeatureRow,
} from "../../shared/types.ts";
import { callModel } from "./provider.ts";
import { num, obj, oneOf, str, strArr } from "./validate.ts";

const COACH =
  "You are the writing and speaking assistant inside Speech Studio, an app that helps people write and rehearse speeches. " +
  "Answer only with the JSON object requested. Do not use tools.";

const textSchema = (key: string) => ({
  type: "object",
  properties: { [key]: { type: "string" } },
  required: [key],
  additionalProperties: false,
});

const fmtTemplate = (t: BriefTemplate) =>
  t.map((f) => `- ${f.key} (${f.label})${f.required ? " [required]" : ""}: ${f.description}`).join("\n");
const fmtBrief = (b: Brief) =>
  Object.entries(b)
    .map(([k, v]) => `- ${k}: ${v ?? "(unknown)"}`)
    .join("\n");

// ---------- Process 1 ----------

/** P1 [model_1 extract]: r1 brief template + r2 request → r3 brief */
export async function extractBrief(template: BriefTemplate, request: string): Promise<Brief> {
  const schema = {
    type: "object",
    properties: Object.fromEntries(template.map((f) => [f.key, { type: ["string", "null"] }])),
    required: template.map((f) => f.key),
    additionalProperties: false,
  };
  return callModel(
    {
      role: "model_1",
      operation: "extractBrief",
      system: COACH,
      prompt:
        `Extract a speech brief from the user's request.\n\nBrief template:\n${fmtTemplate(template)}\n\n` +
        `User's request (all messages so far):\n"""\n${request}\n"""\n\n` +
        `For each field, give the value stated or clearly implied by the user, written concisely. ` +
        `Use null when the user has not provided it. Do not invent facts.`,
      schema,
    },
    (raw) => {
      const o = obj(raw, "brief");
      const brief: Brief = {};
      for (const f of template) {
        const v = o[f.key];
        brief[f.key] = typeof v === "string" && v.trim() && !/^(null|unknown|n\/a)$/i.test(v.trim()) ? v.trim() : null;
      }
      return brief;
    },
  );
}

/** P1 [model_1 generate]~: r1 + r2 + r3 + r4 → r5 follow-up */
export async function generateFollowUp(
  template: BriefTemplate,
  request: string,
  brief: Brief,
  status: BriefStatus,
): Promise<string> {
  const missing = template.filter((f) => status.missing.includes(f.key));
  return callModel(
    {
      role: "model_1",
      operation: "generateFollowUp",
      system: COACH,
      prompt:
        `Brief template:\n${fmtTemplate(template)}\n\nConversation so far:\n"""\n${request}\n"""\n\n` +
        `Extracted brief:\n${fmtBrief(brief)}\n\nCompleteness check: ${status.status}` +
        (missing.length ? `; missing: ${missing.map((f) => f.label).join(", ")}` : "") +
        `\n\n` +
        (status.status === "incomplete"
          ? `Write ONE friendly, short follow-up question asking for the missing information (you may combine at most two closely related missing fields). Offer an example answer in parentheses.`
          : `The brief is complete. Write a short message (2-3 sentences) summarising what you understood and inviting the user to correct anything or continue to the script.`),
      schema: textSchema("message"),
    },
    (raw) => str(obj(raw, "followUp").message, "message"),
  );
}

// ---------- Process 2 ----------

/** P2 [model_1 generate]~: r2 + r3 → r6 approach */
export async function generateApproach(request: string, brief: Brief): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "generateApproach",
      system: COACH,
      prompt:
        `User's request:\n"""\n${request}\n"""\n\nBrief:\n${fmtBrief(brief)}\n\n` +
        `Propose an approach for this speech in plain prose the user can edit: the core message, the angle or hook, ` +
        `the tone and style, a rough structure (opening, 2-4 main parts, closing) with approximate timing, and anything to avoid. ` +
        `Keep it under 220 words. Use short paragraphs or simple "-" lists, no markdown headings.`,
      schema: textSchema("approach"),
    },
    (raw) => str(obj(raw, "approach").approach, "approach"),
  );
}

/** P2 [model_1 extract]: r7 approach (edited) → r8 style spec + r9 outline */
export async function extractPlan(approach: string): Promise<{ styleSpec: StyleSpec; outline: Outline }> {
  const schema = {
    type: "object",
    properties: {
      styleSpec: {
        type: "object",
        properties: {
          tone: { type: "string" },
          register: { type: "string", enum: ["formal", "neutral", "casual"] },
          audienceLevel: { type: "string", enum: ["general", "informed", "expert"] },
          targetWords: { type: "number" },
          mustInclude: { type: "array", items: { type: "string" } },
          avoid: { type: "array", items: { type: "string" } },
        },
        required: ["tone", "register", "audienceLevel", "targetWords", "mustInclude", "avoid"],
      },
      outline: {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                keyPoints: { type: "array", items: { type: "string" } },
                seconds: { type: "number" },
              },
              required: ["title", "keyPoints", "seconds"],
            },
          },
        },
        required: ["sections"],
      },
    },
    required: ["styleSpec", "outline"],
  };
  return callModel(
    {
      role: "model_1",
      operation: "extractPlan",
      system: COACH,
      prompt:
        `The user has agreed on this approach for their speech:\n"""\n${approach}\n"""\n\n` +
        `Extract (1) a style spec: tone (a few words), register, audienceLevel, targetWords (estimate from any stated duration at about 140 words per minute; default 400), ` +
        `mustInclude (specific items the approach says must appear), avoid (things to avoid); and (2) an outline of sections in order, ` +
        `each with a title, 1-4 key points, and an estimated duration in seconds. Only use what the approach says or clearly implies.`,
      schema,
    },
    (raw) => {
      const o = obj(raw, "plan");
      const s = obj(o.styleSpec, "styleSpec");
      const styleSpec: StyleSpec = {
        tone: str(s.tone, "tone"),
        register: oneOf(s.register, "register", ["formal", "neutral", "casual"] as const, "neutral"),
        audienceLevel: oneOf(s.audienceLevel, "audienceLevel", ["general", "informed", "expert"] as const, "general"),
        targetWords: Math.round(num(s.targetWords, "targetWords", 50, 5000)),
        mustInclude: strArr(s.mustInclude ?? [], "mustInclude"),
        avoid: strArr(s.avoid ?? [], "avoid"),
      };
      const sections = obj(o.outline, "outline").sections;
      if (!Array.isArray(sections) || sections.length === 0) throw new Error("outline: no sections");
      const outline: Outline = {
        sections: sections.map((sec, i) => {
          const so = obj(sec, `section ${i}`);
          return {
            title: str(so.title, "title"),
            keyPoints: strArr(so.keyPoints, "keyPoints"),
            seconds: Math.round(num(so.seconds, "seconds", 5, 3600)),
          };
        }),
      };
      return { styleSpec, outline };
    },
  );
}

const fmtStyle = (s: StyleSpec) =>
  `tone: ${s.tone}; register: ${s.register}; audience level: ${s.audienceLevel}; target length: about ${s.targetWords} words` +
  (s.mustInclude.length ? `; must include: ${s.mustInclude.join("; ")}` : "") +
  (s.avoid.length ? `; avoid: ${s.avoid.join("; ")}` : "");
const fmtOutline = (o: Outline) =>
  o.sections.map((s, i) => `${i + 1}. ${s.title} (~${s.seconds}s)\n${s.keyPoints.map((k) => `   - ${k}`).join("\n")}`).join("\n");

const scriptRules =
  "Write it as spoken text only: no headings, stage directions, brackets, markdown, or speaker labels. " +
  "Separate paragraphs with blank lines. Use natural spoken rhythm.";

/** Enforces the r10 constraint: a plain spoken script that stays near the target length. */
function validateScript(raw: unknown, targetWords?: number): string {
  let s = str(obj(raw, "script").script, "script");
  s = s.replace(/^#+\s.*$/gm, "").replace(/\*\*|__/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const words = s.split(/\s+/).length;
  if (words < 20) throw new Error("script too short");
  if (targetWords && (words > targetWords * 2 || words < targetWords * 0.4))
    throw new Error(`script length ${words} words is far from target ${targetWords}`);
  return s;
}

/** P2 [model_1 generate]~: r8 style spec + r9 outline → r10 script */
export async function generateScript(styleSpec: StyleSpec, outline: Outline): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "generateScript",
      system: COACH,
      prompt:
        `Write a speech script.\n\nStyle spec: ${fmtStyle(styleSpec)}\n\nOutline:\n${fmtOutline(outline)}\n\n` +
        `Follow the outline in order and the style spec exactly. ${scriptRules}`,
      schema: textSchema("script"),
    },
    (raw) => validateScript(raw, styleSpec.targetWords),
  );
}

/** P2 [model_1 modify]~: r10 script + r11 feedback → r10 script (revised) */
export async function reviseScript(script: string, feedback: string): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "reviseScript",
      system: COACH,
      prompt:
        `Here is a speech script:\n"""\n${script}\n"""\n\nThe author's feedback:\n"""\n${feedback}\n"""\n\n` +
        `Revise the script to address the feedback. Change only what the feedback asks for or what is needed to make the change read naturally; keep everything else. ${scriptRules}`,
      schema: textSchema("script"),
    },
    (raw) => validateScript(raw),
  );
}

// ---------- Process 3 / 5 ----------

/** P3 [model_1 generate]~: r10 script + r8 style spec → r12 delivery advice */
export async function generateDeliveryAdvice(script: string, styleSpec: StyleSpec): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "generateDeliveryAdvice",
      system: COACH,
      prompt:
        `Script:\n"""\n${script}\n"""\n\nStyle spec: ${fmtStyle(styleSpec)}\n\n` +
        `Advise how this script should be delivered aloud: a suitable pace in words per minute, pitch (lower, normal or higher), ` +
        `the overall vocal tone, how long pauses should be and where, and 3-8 specific words or short phrases to emphasise. ` +
        `Be concrete and brief (under 150 words), plain prose or "-" lists.`,
      schema: textSchema("advice"),
    },
    (raw) => str(obj(raw, "advice").advice, "advice"),
  );
}

/** P3/P5 [model_1 translate]~: r13 voice settings → r14 voice direction (instruction language) */
export async function translateVoiceSettings(script: string, settings: VoiceSettings): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "translateVoiceSettings",
      system: COACH,
      prompt:
        `Turn these voice settings into a direction for a speech-synthesis model, as you would brief a voice actor.\n\n` +
        `Settings: voice ${settings.voice}; pace ${settings.rate} words per minute; pitch ${settings.pitch}; tone "${settings.tone}"; ` +
        `pauses ${settings.pauses}; emphasise: ${settings.emphasisWords.join(", ") || "(none)"}.\n\n` +
        `Script for context:\n"""\n${script}\n"""\n\n` +
        `Write 3-6 sentences in plain language: overall pace and pitch, tone, where to pause (after which sentences or ideas), ` +
        `which words to stress, and where to slow down or speed up. Keep the stated numbers.`,
      schema: textSchema("direction"),
    },
    (raw) => str(obj(raw, "direction").direction, "direction"),
  );
}

// ---------- Process 4 ----------

/** Text form of r20 (the prosody chart) and r15 (the audio) for a model that cannot see or hear them. */
export function describeTake(duration: number, rows: WordFeatureRow[]): string {
  const voiced = rows.filter((r) => r.pitchHz);
  const pitches = voiced.map((r) => r.pitchHz as number);
  const mean = pitches.reduce((a, b) => a + b, 0) / Math.max(1, pitches.length);
  const sd = Math.sqrt(pitches.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, pitches.length));
  const wpm = rows.length / (duration / 60);
  const pauses = rows.filter((r) => r.pauseAfter >= 0.25);
  const head =
    `Audio duration ${duration.toFixed(1)} s, ${rows.length} words, overall pace ${wpm.toFixed(0)} wpm, ` +
    `mean pitch ${mean.toFixed(0)} Hz (sd ${sd.toFixed(0)} Hz), ${pauses.length} pauses of at least 0.25 s.`;
  const table = rows
    .map(
      (r) =>
        `${r.index}\t${r.word}\t${r.start.toFixed(2)}\t${r.duration.toFixed(2)}\t${r.pitchHz ? r.pitchHz.toFixed(0) : "-"}\t${r.loudnessDb.toFixed(1)}\t${r.pauseAfter.toFixed(2)}`,
    )
    .join("\n");
  return `${head}\nPer-word measurements (the data plotted in the prosody chart):\nidx\tword\tstart_s\tdur_s\tpitch_hz\tloudness_db\tpause_after_s\n${table}`;
}

/** P4 [model_1 generate]~: r15 audio + r20 chart + r10 script → r21 delivery analysis */
export async function analyzeDelivery(script: string, takeDescription: string): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "analyzeDelivery",
      system: COACH,
      prompt:
        `A synthetic voice read this script aloud:\n"""\n${script}\n"""\n\nMeasurements of the recording and its prosody chart:\n${takeDescription}\n\n` +
        `Analyse the delivery: pace (overall and where it rushes or drags), pitch variation (monotone stretches vs. expressive moments), ` +
        `loudness, and whether pauses land at meaningful places. Cite specific words or time ranges. Under 200 words, "-" lists are fine.`,
      schema: textSchema("analysis"),
    },
    (raw) => str(obj(raw, "analysis").analysis, "analysis"),
  );
}

/** P4 [model_1 generate]~: r15 audio + r10 script + r22 listener feedback → r23 coaching tips */
export async function generateCoaching(script: string, takeDescription: string, feedback: string): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "generateCoaching",
      system: COACH,
      prompt:
        `Script:\n"""\n${script}\n"""\n\nMeasurements of the rehearsal recording:\n${takeDescription}\n\n` +
        `The speaker listened to the recording and wrote:\n"""\n${feedback}\n"""\n\n` +
        `Give coaching tips the speaker can use when delivering this speech themselves: 4-6 concrete tips that respond to their feedback, ` +
        `each tied to a specific passage, plus one short practice exercise. Under 250 words.`,
      schema: textSchema("tips"),
    },
    (raw) => str(obj(raw, "tips").tips, "tips"),
  );
}

/** P4 [model_1 generate]~: r24 question → r25 answer (the state holds r24 alone) */
export async function answerCoachQuestion(question: string): Promise<string> {
  return callModel(
    {
      role: "model_1",
      operation: "answerCoachQuestion",
      system: COACH + " You are acting as a public-speaking coach.",
      prompt: `${question}\n\nRespond as a public-speaking coach, concisely (under 200 words).`,
      schema: textSchema("answer"),
    },
    (raw) => str(obj(raw, "answer").answer, "answer"),
  );
}

export type { BriefStatus };
