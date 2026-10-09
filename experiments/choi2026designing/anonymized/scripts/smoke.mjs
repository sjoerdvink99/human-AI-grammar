// End-to-end walk through all five processes against a running server (default http://localhost:3001).
const base = process.env.BASE ?? "http://localhost:3001";
const post = async (p, body) => {
  const t = Date.now();
  const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  console.log(`✓ ${p} (${Date.now() - t} ms)`);
  return j;
};
const template = await (await fetch(base + "/api/template")).json();
// P1
let request = "User: I need a 1-minute toast for my best friend Sam's 30th birthday dinner. About 12 friends will be there. I'm the speaker, their friend since college.";
let brief = await post("/api/brief/extract", { template, request });
let status = await post("/api/brief/check", { template, brief });
let { followUp } = await post("/api/brief/follow-up", { template, request, brief, status });
console.log("  r4:", status, "\n  r5:", followUp);
request += `\n\nAssistant: ${followUp}\n\nUser: The point is to celebrate Sam: mention our road trip to Lisbon where the car broke down, and that Sam always shows up for people. Funny but warm.`;
brief = await post("/api/brief/extract", { template, request });
status = await post("/api/brief/check", { template, brief });
console.log("  r4 after loop:", status);
// P2
const { approach } = await post("/api/approach", { request, brief });
const plan = await post("/api/plan", { approach });
console.log("  r8:", JSON.stringify(plan.styleSpec));
let { script } = await post("/api/script", plan);
({ script } = await post("/api/script/revise", { script, feedback: "Make the ending shorter and end with raising a glass." }));
console.log("  r10:", script.slice(0, 200), "…");
// P3
const { advice } = await post("/api/delivery-advice", { script, styleSpec: plan.styleSpec });
const voiceSettings = { voice: "Samantha", rate: 160, pitch: "normal", tone: "warm and playful", pauses: "medium", emphasisWords: ["Lisbon", "Sam"] };
const take = async (vs) => {
  const { direction } = await post("/api/voice-direction", { script, voiceSettings: vs });
  const sp = await post("/api/speech", { direction, script });
  const a = await post("/api/take/analyze", { audioUrl: sp.audioUrl, script });
  console.log(`  r15 ${sp.audioUrl} fallback=${sp.fallback} duration=${a.duration.toFixed(1)}s segments=${a.segments.length} words=${a.wordFeatures.length}`);
  return a;
};
const t1 = await take(voiceSettings);
// P4
await post("/api/delivery-analysis", { script, duration: t1.duration, wordFeatures: t1.wordFeatures });
const feedback = "A bit too fast and flat in the Lisbon story.";
const { tips } = await post("/api/coaching", { script, duration: t1.duration, wordFeatures: t1.wordFeatures, feedback });
const { answer } = await post("/api/coach-answer", { question: "How do I keep from rushing a funny story in a toast?" });
console.log("  r23:", tips.slice(0, 150), "…\n  r25:", answer.slice(0, 150), "…");
// P5
const t2 = await take({ ...voiceSettings, rate: 135, pauses: "long" });
console.log(`  take2 duration ${t2.duration.toFixed(1)}s vs take1 ${t1.duration.toFixed(1)}s`);
console.log("ALL PROCESSES OK");
