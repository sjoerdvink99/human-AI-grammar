// The take pipeline shared by process 3 (first take) and process 5 (re-take):
// r13 → [model_1 translate]~ → r14 → [model_2 generate]~ → r15 → [tool_2 extract] → r16 + r17
//     → [tool_3 match] → r18 → [tool_4 extract] → r19 → [tool_5 translate] → r20
import type { Take, VoiceSettings } from "../../shared/types.ts";
import { post } from "./api.ts";
import type { PipelineStep } from "./components/Pipeline.tsx";

export const TAKE_PIPELINE: PipelineStep[] = [
  { label: "Write voice direction", actor: "model_1 translate" },
  { label: "Synthesize speech", actor: "model_2 generate" },
  { label: "Analyse audio, align words, tabulate, chart", actor: "tool_2–tool_5" },
];

export async function recordTake(
  script: string,
  voiceSettings: VoiceSettings,
  version: number,
  onStage: (i: number) => void,
): Promise<Take> {
  onStage(0);
  const { direction } = await post<{ direction: string }>("/api/voice-direction", { script, voiceSettings });
  onStage(1);
  const { audioUrl, fallback } = await post<{ audioUrl: string; fallback: boolean }>("/api/speech", { direction, script });
  onStage(2);
  const a = await post<Pick<Take, "duration" | "segments" | "prosody" | "wordTimings" | "wordFeatures" | "chartSvg">>(
    "/api/take/analyze",
    { audioUrl, script },
  );
  onStage(3);
  return {
    id: crypto.randomUUID(),
    version,
    script,
    voiceSettings,
    voiceDirection: direction,
    audioUrl,
    speechFallback: fallback,
    createdAt: new Date().toISOString(),
    ...a,
  };
}
