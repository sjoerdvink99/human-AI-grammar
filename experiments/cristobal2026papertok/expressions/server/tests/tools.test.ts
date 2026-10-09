import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractJSON } from "../providers/llm.ts";
import { voiceParams } from "../providers/tts.ts";
import { wavDurationFromBuffer, stillToClip, muxClip, stillToVideo, concatClips } from "../tools/media.ts";
import { extractAuthors, guessTitle } from "../tools/paper.ts";
import { composeCreditText } from "../tools/credits.ts";
import { sanitizeSvg, renderSvg } from "../tools/svg.ts";
import { stringList, validateRatings, validateScript } from "../pipeline.ts";
import { composeBaselineVoiceStyle } from "../tools/voice.ts";

test("extractJSON handles fences and prose", () => {
  assert.deepEqual(extractJSON('Sure!\n```json\n["a","b"]\n```'), ["a", "b"]);
  assert.deepEqual(extractJSON('{"x":1} trailing'), { x: 1 });
});

test("validators enforce shape", () => {
  assert.throws(() => stringList(3, 5)(["a"]));
  assert.deepEqual(validateRatings(2)([7, "11"]), [7, 10]);
  assert.throws(() => validateRatings(3)([1, 2]));
  assert.throws(() => validateScript({ title: "t" }));
  const s = validateScript({ title: "t", hook: "h", body: "b", closing: "c", target_seconds: 500 });
  assert.equal(s.target_seconds, 180);
  assert.match(composeBaselineVoiceStyle(s), /Pace:/);
});

test("voice params follow style keywords and variations", () => {
  assert.ok(voiceParams("energetic").rate > voiceParams("calm").rate);
  assert.equal(voiceParams("deep male voice").voice, "Daniel");
  assert.ok(voiceParams("neutral", "calmer").rate < voiceParams("neutral").rate);
});

test("svg sanitizer strips scripts and external refs", () => {
  const out = sanitizeSvg('x<svg><script>alert(1)</script><image href="file:///etc/passwd"/><rect onclick="x()"/></svg>y');
  assert.ok(!/script|passwd|onclick/.test(out));
});

test("authors and title from first page text", () => {
  const text = "A Study of Things\n\nJane Doe1, John Smith2 and Ada Lovelace\n1 University of Somewhere\n\nAbstract\nWe study things.";
  assert.equal(guessTitle(text), "A Study of Things");
  assert.deepEqual(extractAuthors(text, "A Study of Things"), ["Jane Doe", "John Smith", "Ada Lovelace"]);
  assert.equal(composeCreditText("T", ["A", "B", "C"]), "Based on the paper “T” by A, B, and C.");
});

test("media pipeline: say → duration → still video → clip → concat", { timeout: 120_000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "p2v-"));
  const wav = path.join(dir, "a.wav");
  execFileSync("say", ["--file-format=WAVE", "--data-format=LEI16@22050", "-o", wav, "Hello world, this is a test."]);
  const d = wavDurationFromBuffer(await fs.readFile(wav));
  assert.ok(d > 0.5 && d < 5, `duration ${d}`);
  const png = path.join(dir, "s.png");
  await renderSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280"><rect width="720" height="1280" fill="teal"/></svg>', png, 720, 1280);
  await stillToVideo(png, d, path.join(dir, "v.mp4"));
  await muxClip(path.join(dir, "v.mp4"), wav, d, path.join(dir, "c.mp4"));
  await stillToClip(png, 1, path.join(dir, "credit.mp4"));
  await concatClips([path.join(dir, "c.mp4"), path.join(dir, "credit.mp4")], path.join(dir, "final.mp4"));
  assert.ok((await fs.stat(path.join(dir, "final.mp4"))).size > 1000);
});
