import type { ScriptRecord } from "../types.ts";

/**
 * tool_1 compose (baseline_voice_style_1): a deterministic default narration style derived
 * from the selected script's length and closing, used as the starting point for tone discussion.
 */
export function composeBaselineVoiceStyle(script: ScriptRecord): string {
  const words = `${script.hook} ${script.body} ${script.closing}`.split(/\s+/).filter(Boolean).length;
  const wpm = Math.round((words / Math.max(15, script.target_seconds)) * 60);
  const pace = wpm > 175 ? "brisk" : wpm < 140 ? "relaxed" : "steady";
  return [
    "Clear, friendly science-communicator narration in English.",
    `Pace: ${pace} (about ${wpm} words per minute to fit ${script.target_seconds} seconds).`,
    "Emphasise the hook in the first sentence, pause briefly between ideas, avoid jargon,",
    script.closing.trim().endsWith("?") ? "and end on an inviting, curious question." : "and end on a confident, warm note.",
  ].join(" ");
}
