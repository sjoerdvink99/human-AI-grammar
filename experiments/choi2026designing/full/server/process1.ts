// Process 1 — Therapeutic conversation
// (therapy_framework_1 + chat_history_1) -> [model_1 extract] -> +required_variables_1
// -> [tool_1 evaluate] -> +step_status_1 -> [model_1 generate]~ -> question_1
// -> [human specify] -> (therapy_framework_1 + chat_history_1)   (loop)
import { z } from "zod";
import { callModel } from "./llm.ts";
import { THERAPY_FRAMEWORK, ALL_VARIABLE_KEYS, type TherapyFramework } from "./framework.ts";
import { evaluateStepStatus, isFilled } from "./tools/stepChecker.ts";
import type { ChatTurn, RequiredVariables, Session, StepStatus } from "./types.ts";
import { pushFeed, save } from "./store.ts";
import { SYSTEM_MODEL_1 } from "./persona.ts";
import { startLyricWriting } from "./process2.ts";

export function formatChat(chat: ChatTurn[]): string {
  if (chat.length === 0) return "(the conversation has not started yet)";
  return chat.map((t) => `${t.role === "assistant" ? "Companion" : "Person"}: ${t.text}`).join("\n");
}

function formatFramework(f: TherapyFramework): string {
  return [
    `Principles:\n${f.principles.map((p) => `- ${p}`).join("\n")}`,
    ...f.steps.map(
      (s, i) => `Step ${i + 1} "${s.title}" — ${s.goal}\n${s.variables.map((v) => `  * ${v.key}: ${v.description}`).join("\n")}`,
    ),
  ].join("\n");
}

/** model_1 extract: therapy_framework + chat_history -> required_variables */
export async function extractRequiredVariables(
  framework: TherapyFramework,
  chat: ChatTurn[],
  previous: RequiredVariables,
): Promise<RequiredVariables> {
  if (!chat.some((t) => t.role === "user")) return { ...previous };
  const schema = z.object(Object.fromEntries(ALL_VARIABLE_KEYS.map((k) => [k, z.string()]))) as z.ZodObject<
    Record<string, z.ZodString>
  >;
  const out = await callModel({
    role: "model_1",
    op: "model_1 extract",
    system: SYSTEM_MODEL_1,
    prompt:
      `Therapy framework:\n${formatFramework(framework)}\n\nConversation so far:\n${formatChat(chat)}\n\n` +
      `Extract the value of every framework variable from what the PERSON has said, in a short phrase using their own words where possible. ` +
      `Use an empty string "" for anything they have not shared yet. If they explicitly declined to share something, write "prefers not to say". Do not invent anything.`,
    schema,
  });
  const merged: RequiredVariables = { ...previous };
  for (const k of ALL_VARIABLE_KEYS) {
    const v = (out[k] ?? "").trim();
    if (isFilled(v)) merged[k] = v;
    else if (!(k in merged)) merged[k] = "";
  }
  return merged;
}

/** model_1 generate~: framework + chat + required_variables + step_status -> question */
export async function generateQuestion(
  framework: TherapyFramework,
  chat: ChatTurn[],
  vars: RequiredVariables,
  status: StepStatus,
): Promise<string> {
  const step = framework.steps[status.currentStep];
  const out = await callModel({
    role: "model_1",
    op: "model_1 generate (question)",
    system: SYSTEM_MODEL_1,
    prompt:
      `Therapy framework:\n${formatFramework(framework)}\n\nConversation so far:\n${formatChat(chat)}\n\n` +
      `Information gathered so far: ${JSON.stringify(vars)}\n` +
      `Step status: ${status.status === "complete" ? "the previous step was just completed; move gently to the new step" : "the current step still needs information"}.\n` +
      `Current step: "${step.title}" — ${step.goal}. Still missing: ${status.missing.join(", ") || "nothing"}.\n\n` +
      (chat.length === 0
        ? "This is the very start of the session: greet the person, briefly explain that you will talk a little and then write a song together, and ask your first question.\n"
        : "") +
      `Write the companion's next message: at most 3 short sentences, first briefly acknowledge what the person just said (if anything), then ask ONE supportive, open question aimed at the missing information. Plain language.`,
    schema: z.object({ question: z.string().min(3).max(800) }),
  });
  return out.question.trim();
}

/** One round of the process-1 loop, starting from therapy_framework + chat_history. */
export async function runTherapyRound(s: Session, setBusy: (op: string, label: string) => void) {
  setBusy("model_1 extract", "Understanding what you shared…");
  s.requiredVariables = await extractRequiredVariables(THERAPY_FRAMEWORK, s.chatHistory, s.requiredVariables);
  save(s);

  setBusy("tool_1 evaluate", "Checking the session step…");
  const status = evaluateStepStatus(THERAPY_FRAMEWORK, s.requiredVariables, s.stepStatus.currentStep, s.turnsInStep);
  if (status.advancedBy > 0) s.turnsInStep = 0;
  const { advancedBy: _ignored, ...stepStatus } = status;
  s.stepStatus = stepStatus;
  save(s);

  if (status.allComplete) {
    // the loop ends when every step has its information -> process 2 continues from chat_history_1
    pushFeed(s, { kind: "system", role: "system", text: "We've talked through everything we need. Let's start writing your song." });
    await startLyricWriting(s, setBusy);
    return;
  }

  setBusy("model_1 generate", "Thinking of a question…");
  const question = await generateQuestion(THERAPY_FRAMEWORK, s.chatHistory, s.requiredVariables, s.stepStatus);
  s.chatHistory.push({ role: "assistant", text: question, at: new Date().toISOString() });
  pushFeed(s, { kind: "question", role: "assistant", text: question });
  save(s);
}

/** human specify: the person's answer is added to chat_history, then the loop repeats. */
export function addAnswer(s: Session, text: string) {
  s.chatHistory.push({ role: "user", text, at: new Date().toISOString() });
  s.turnsInStep += 1;
  pushFeed(s, { kind: "answer", role: "user", text });
  save(s);
}
