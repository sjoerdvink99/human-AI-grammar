import type { EnergyEstimate, ModelChoice, OptimizeResponse, OptimizerWeights, WebCode } from "../../shared/types.ts";

export interface TrainingStatus {
  running: boolean;
  message: string;
  done: number;
  total: number;
  error?: string;
}

export async function getOptimizer(): Promise<{ weights: OptimizerWeights | null; training: TrainingStatus }> {
  const r = await fetch("/api/optimizer");
  return r.json();
}

export async function startTraining(pages: number): Promise<void> {
  const r = await fetch("/api/train", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages }) });
  if (!r.ok) throw new Error((await r.json()).error);
}

export async function generate(request: string, modelChoice: ModelChoice): Promise<WebCode> {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, modelChoice }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j.code;
}

export type OptimizeEvent =
  | { stage: "baseline" | "optimize" | "after" | "warning"; message: string }
  | { stage: "baseline-done"; energyBefore: EnergyEstimate }
  | { stage: "result"; result: OptimizeResponse }
  | { stage: "error"; error: string };

export async function optimize(code: WebCode, onEvent: (e: OptimizeEvent) => void): Promise<void> {
  const r = await fetch("/api/optimize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}
