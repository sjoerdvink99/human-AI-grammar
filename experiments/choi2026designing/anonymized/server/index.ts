// HTTP API: one endpoint per grammar transformation (tool_2..tool_5 are chained in one endpoint
// because they are deterministic and run back-to-back in every take).
import express, { type Request, type Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import type { Brief, BriefStatus, BriefTemplate, Outline, StyleSpec, VoiceSettings, WordFeatureRow } from "../shared/types.ts";
import { DEFAULT_TEMPLATE } from "./defaults.ts";
import * as ops from "./model/operations.ts";
import { AUDIO_DIR, listVoices, synthesizeSpeech } from "./model/speech.ts";
import { checkBrief } from "./tools/briefCheck.ts";
import { analyzeAudio } from "./tools/audioAnalysis.ts";
import { alignWords } from "./tools/align.ts";
import { buildWordFeatures } from "./tools/features.ts";
import { renderProsodyChart } from "./tools/chart.ts";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/audio", express.static(AUDIO_DIR));

const need = (cond: unknown, msg: string) => {
  if (!cond) throw Object.assign(new Error(msg), { status: 400 });
};
const route = (p: string, fn: (body: any) => Promise<unknown> | unknown) =>
  app.post(p, async (req: Request, res: Response) => {
    try {
      res.json(await fn(req.body ?? {}));
    } catch (e) {
      const err = e as Error & { status?: number };
      console.error(`POST ${p}:`, err.message);
      res.status(err.status ?? 502).json({ error: err.message });
    }
  });

const audioFile = (url: string) => {
  const m = /^\/audio\/([0-9a-f-]{36})\.wav$/.exec(url ?? "");
  need(m, "invalid audio url");
  const f = path.join(AUDIO_DIR, `${m![1]}.wav`);
  need(existsSync(f), "audio not found");
  return f;
};

app.get("/api/template", (_req, res) => res.json(DEFAULT_TEMPLATE));
app.get("/api/voices", async (_req, res) => res.json(await listVoices()));

// ---- Process 1
route("/api/brief/extract", (b: { template: BriefTemplate; request: string }) => {
  need(b.request?.trim(), "request is empty");
  return ops.extractBrief(b.template, b.request);
});
route("/api/brief/check", (b: { template: BriefTemplate; brief: Brief }) => checkBrief(b.template, b.brief));
route("/api/brief/follow-up", (b: { template: BriefTemplate; request: string; brief: Brief; status: BriefStatus }) =>
  ops.generateFollowUp(b.template, b.request, b.brief, b.status).then((followUp) => ({ followUp })),
);

// ---- Process 2
route("/api/approach", (b: { request: string; brief: Brief }) => ops.generateApproach(b.request, b.brief).then((approach) => ({ approach })));
route("/api/plan", (b: { approach: string }) => {
  need(b.approach?.trim(), "approach is empty");
  return ops.extractPlan(b.approach);
});
route("/api/script", (b: { styleSpec: StyleSpec; outline: Outline }) => ops.generateScript(b.styleSpec, b.outline).then((script) => ({ script })));
route("/api/script/revise", (b: { script: string; feedback: string }) => {
  need(b.feedback?.trim(), "feedback is empty");
  return ops.reviseScript(b.script, b.feedback).then((script) => ({ script }));
});

// ---- Process 3 / 5
route("/api/delivery-advice", (b: { script: string; styleSpec: StyleSpec }) =>
  ops.generateDeliveryAdvice(b.script, b.styleSpec).then((advice) => ({ advice })),
);
route("/api/voice-direction", (b: { script: string; voiceSettings: VoiceSettings }) =>
  ops.translateVoiceSettings(b.script, b.voiceSettings).then((direction) => ({ direction })),
);
route("/api/speech", async (b: { direction: string; script: string }) => {
  need(b.direction?.trim() && b.script?.trim(), "direction and script are required");
  const r = await synthesizeSpeech(b.direction, b.script);
  return { audioUrl: r.url, fallback: r.fallback };
});
route("/api/take/analyze", (b: { audioUrl: string; script: string }) => {
  const file = audioFile(b.audioUrl);
  const { duration, segments, prosody } = analyzeAudio(file); // tool_2 extract → r16, r17
  const wordTimings = alignWords(b.script, segments, duration); // tool_3 match → r18
  const wordFeatures = buildWordFeatures(wordTimings, prosody); // tool_4 extract → r19
  const chartSvg = renderProsodyChart(wordFeatures, prosody, duration); // tool_5 translate → r20
  return { duration, segments, prosody, wordTimings, wordFeatures, chartSvg };
});

// ---- Process 4
type TakeBody = { script: string; duration: number; wordFeatures: WordFeatureRow[] };
route("/api/delivery-analysis", (b: TakeBody) =>
  ops.analyzeDelivery(b.script, ops.describeTake(b.duration, b.wordFeatures)).then((analysis) => ({ analysis })),
);
route("/api/coaching", (b: TakeBody & { feedback: string }) => {
  need(b.feedback?.trim(), "feedback is empty");
  return ops.generateCoaching(b.script, ops.describeTake(b.duration, b.wordFeatures), b.feedback).then((tips) => ({ tips }));
});
route("/api/coach-answer", (b: { question: string }) => {
  need(b.question?.trim(), "question is empty");
  return ops.answerCoachQuestion(b.question).then((answer) => ({ answer }));
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/audio).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Speech Studio API on http://localhost:${port}`));
