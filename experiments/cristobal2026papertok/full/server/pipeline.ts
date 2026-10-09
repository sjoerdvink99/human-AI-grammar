// model_1 (large language model) steps and the orchestration of processes 1–7.
import fs from 'node:fs';
import path from 'node:path';
import { callModelValidated } from './model.ts';
import { composeClip, concatClips, generateSceneVideo, measureDuration, renderCreditScene, stillToClip, synthesizeSpeech } from './media.ts';
import { projectDir, saveProject } from './store.ts';
import { composeBaselineVoiceStyle, composeCreditText, ensureDir, extractAuthors, extractScreenshot } from './tools.ts';
import { OPTION_COUNT, SCENE_COUNT, type ClipVersion, type Hook, type HookRating, type Project, type Scene, type ScriptRecord } from './types.ts';

const PAPER_LIMIT = 60_000;
const SYSTEM = 'You are a science communicator who turns academic papers into accurate, engaging 60-second vertical videos for a general audience. Never invent results that are not in the paper. Answer only with the requested JSON.';

const strArray = (key: string) => ({ type: 'object', properties: { [key]: { type: 'array', items: { type: 'string' } } }, required: [key] });
const nonEmpty = (xs: unknown, min: number, what: string) =>
  !Array.isArray(xs) || xs.filter((x) => typeof x === 'string' && x.trim()).length < min ? `need at least ${min} non-empty ${what}` : null;

function paperBlock(p: Project) {
  const t = p.paper.text.length > PAPER_LIMIT ? p.paper.text.slice(0, PAPER_LIMIT) + '\n[…truncated]' : p.paper.text;
  return `<paper title="${p.paper.title}">\n${t}\n</paper>`;
}
const list = (xs: string[]) => xs.map((x, i) => `${i + 1}. ${x}`).join('\n');
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// ================================================================ process 1: generate hooks and scripts

/** model_1 extract: paper -> findings* */
export async function extractFindings(p: Project) {
  const r = await callModelValidated<{ findings: string[] }>({
    step: 'model_1 extract (findings)', system: SYSTEM,
    prompt: `${paperBlock(p)}\n\nExtract 5–8 concrete findings from this paper. Each finding is one plain-language sentence with the specific result (numbers, effects, comparisons) and no jargon.`,
    schema: strArray('findings'),
  }, (v) => nonEmpty(v.findings, 3, 'findings'));
  return r.findings.map((s) => s.trim()).filter(Boolean);
}

/** model_1 generate~: paper (+ findings) -> story_ideas* */
export async function generateStoryIdeas(p: Project) {
  const r = await callModelValidated<{ story_ideas: string[] }>({
    step: 'model_1 generate (story ideas)', system: SYSTEM,
    prompt: `${paperBlock(p)}\n\nConcrete findings:\n${list(p.findings!)}\n\nPropose 5 distinct ideas for telling this paper's story to a general audience in a 60-second vertical video (e.g. everyday problem → discovery, surprising number, myth-busting, "what if", human angle). One or two sentences each.`,
    schema: strArray('story_ideas'),
  }, (v) => nonEmpty(v.story_ideas, 3, 'story ideas'));
  return r.story_ideas;
}

/** model_1 generate~: paper + story_ideas -> hooks* */
export async function generateHooks(p: Project): Promise<Hook[]> {
  const r = await callModelValidated<{ hooks: string[] }>({
    step: 'model_1 generate (hooks)', system: SYSTEM,
    prompt: `${paperBlock(p)}\n\nStory ideas:\n${list(p.storyIdeas!)}\n\nWrite 10 attention-grabbing opening lines (hooks) for the first 3 seconds of the video. Each at most 20 words, spoken aloud, faithful to the paper, varied across the story ideas.`,
    schema: strArray('hooks'),
  }, (v) => nonEmpty(v.hooks, 6, 'hooks') ?? (v.hooks.some((h) => wordCount(h) > 30) ? 'each hook must be at most 20 words' : null));
  return r.hooks.filter((h) => h.trim()).map((text, i) => ({ id: `h${i + 1}`, text: text.trim() }));
}

/** model_1 evaluate: hooks -> hook_ratings* (numeric, 1–10) */
export async function rateHooks(p: Project): Promise<HookRating[]> {
  const hooks = p.hooks!;
  const r = await callModelValidated<{ ratings: HookRating[] }>({
    step: 'model_1 evaluate (hook ratings)', system: SYSTEM,
    prompt: `${paperBlock(p)}\n\nRate how engaging each hook is for a scrolling general audience, 1 (dull) to 10 (irresistible), while penalising hooks that overstate the paper. Give a short reason.\n\n${hooks.map((h) => `${h.id}: ${h.text}`).join('\n')}`,
    schema: { type: 'object', properties: { ratings: { type: 'array', items: { type: 'object', properties: { hookId: { type: 'string' }, score: { type: 'number' }, reason: { type: 'string' } }, required: ['hookId', 'score', 'reason'] } } }, required: ['ratings'] },
  }, (v) => {
    const ids = new Set(v.ratings?.map((x) => x.hookId));
    if (!hooks.every((h) => ids.has(h.id))) return 'rate every hook id exactly once';
    if (v.ratings.some((x) => !(x.score >= 1 && x.score <= 10))) return 'scores must be between 1 and 10';
    return null;
  });
  return hooks.map((h) => r.ratings.find((x) => x.hookId === h.id)!);
}

/** model_1 select: hooks + hook_ratings -> shortlisted_hooks* (exactly OPTION_COUNT) */
export async function shortlistHooks(p: Project): Promise<string[]> {
  const rated = p.hooks!.map((h) => ({ ...h, r: p.hookRatings!.find((x) => x.hookId === h.id)! }));
  const r = await callModelValidated<{ hookIds: string[] }>({
    step: 'model_1 select (shortlist)', system: SYSTEM,
    prompt: `Choose the ${OPTION_COUNT} best hooks to develop into full scripts. Favour high ratings but keep the four meaningfully different from each other.\n\n${rated.map((h) => `${h.id} [${h.r.score}/10]: ${h.text}`).join('\n')}`,
    schema: strArray('hookIds'),
  }, (v) => {
    const ids = [...new Set(v.hookIds ?? [])];
    if (ids.length !== OPTION_COUNT) return `choose exactly ${OPTION_COUNT} distinct ids`;
    if (ids.some((id) => !p.hooks!.some((h) => h.id === id))) return 'unknown hook id';
    return null;
  });
  return [...new Set(r.hookIds)];
}

/** model_1 generate~: paper + shortlisted_hooks -> script_options* (four hook + eight-scene scripts) */
export async function generateScriptOptions(p: Project): Promise<ScriptRecord[]> {
  const hooks = p.shortlistedHooks!.map((id) => p.hooks!.find((h) => h.id === id)!.text);
  const r = await callModelValidated<{ options: ScriptRecord[] }>({
    step: 'model_1 generate (script options)', system: SYSTEM,
    prompt: `${paperBlock(p)}\n\nWrite one script for each of these ${OPTION_COUNT} hooks, in the same order:\n${list(hooks)}\n\nEach script has a short working title, the hook (verbatim), and exactly ${SCENE_COUNT} scenes of spoken narration. Scene 1 opens with the hook. Each scene is 1–2 sentences, 12–30 words; the whole script should take about 60 seconds to say quickly. Cover: hook, problem, what the researchers did, key findings with concrete numbers, why it matters, a closing line. Plain language, no hashtags or stage directions.`,
    schema: { type: 'object', properties: { options: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, hook: { type: 'string' }, scenes: { type: 'array', items: { type: 'string' } } }, required: ['title', 'hook', 'scenes'] } } }, required: ['options'] },
    timeoutMs: 8 * 60_000,
  }, (v) => {
    if (v.options?.length !== OPTION_COUNT) return `need exactly ${OPTION_COUNT} options`;
    for (const [i, o] of v.options.entries()) {
      if (o.scenes?.length !== SCENE_COUNT) return `option ${i + 1} must have exactly ${SCENE_COUNT} scenes`;
      if (o.scenes.some((s) => !s.trim() || wordCount(s) > 45)) return `option ${i + 1} has an empty or overlong scene`;
    }
    return null;
  });
  return r.options.map((o, i) => ({ title: o.title.trim(), hook: hooks[i], scenes: o.scenes.map((s) => s.trim()) }));
}

export async function runProcess1(p: Project, stage: (s: string) => void) {
  for (const k of ['findings', 'storyIdeas', 'hooks', 'hookRatings', 'shortlistedHooks', 'scriptOptions'] as const) delete p[k];
  stage('Extracting findings'); p.findings = await extractFindings(p); saveProject(p);
  stage('Developing story ideas'); p.storyIdeas = await generateStoryIdeas(p); saveProject(p);
  stage('Writing hooks'); p.hooks = await generateHooks(p); saveProject(p);
  stage('Rating hooks'); p.hookRatings = await rateHooks(p); saveProject(p);
  stage('Shortlisting hooks'); p.shortlistedHooks = await shortlistHooks(p); saveProject(p);
  stage('Writing four scripts'); p.scriptOptions = await generateScriptOptions(p);
}

// ================================================================ process 2: choose script and voiceover style

/** human select (script_options -> script) followed by tool_1 compose (baseline_voice_style). */
export function selectScript(p: Project, option: number) {
  const chosen = p.scriptOptions![option];
  p.selectedOption = option;
  p.script = structuredClone(chosen);
  p.originalScript = structuredClone(chosen);
  p.baselineVoiceStyle = composeBaselineVoiceStyle();
  delete p.toneSuggestion; delete p.tonePreference; delete p.voiceStyle;
}

const scriptText = (s: ScriptRecord) => `Title: ${s.title}\nHook: ${s.hook}\n${s.scenes.map((x, i) => `Scene ${i + 1}: ${x}`).join('\n')}`;

/** model_1 generate~: script + baseline_voice_style -> tone_suggestion */
export async function suggestTone(p: Project) {
  const r = await callModelValidated<{ tone: string }>({
    step: 'model_1 generate (tone suggestion)', system: SYSTEM,
    prompt: `${scriptText(p.script!)}\n\nDefault narration style: ${p.baselineVoiceStyle}\n\nSuggest a voiceover tone that suits this script (one short phrase plus one sentence of explanation, max 30 words), e.g. "Curious and upbeat — like sharing a surprising fact with a friend."`,
    schema: { type: 'object', properties: { tone: { type: 'string' } }, required: ['tone'] },
  }, (v) => (!v.tone?.trim() ? 'empty tone' : wordCount(v.tone) > 45 ? 'too long' : null));
  return r.tone.trim();
}

/** model_1 compose~: baseline_voice_style + tone_preference -> voice_style */
export async function composeVoiceStyle(p: Project) {
  const r = await callModelValidated<{ voice_style: string }>({
    step: 'model_1 compose (voice style)', system: SYSTEM,
    prompt: `Merge the default narration style with the researcher's tone into one concise narration instruction (max 60 words) for a voice actor or TTS engine. Keep the fast pace of the default unless the tone explicitly asks otherwise.\n\nDefault style: ${p.baselineVoiceStyle}\nResearcher's tone: ${p.tonePreference}\n\nScript (for context):\n${scriptText(p.script!)}`,
    schema: { type: 'object', properties: { voice_style: { type: 'string' } }, required: ['voice_style'] },
  }, (v) => (!v.voice_style?.trim() ? 'empty voice style' : null));
  return r.voice_style.trim();
}

// ================================================================ process 4: storyboard and clips

/** model_1 decompose: script -> scene_scripts* (narration per scene) */
export async function decomposeScript(p: Project) {
  const r = await callModelValidated<{ scene_scripts: string[] }>({
    step: 'model_1 decompose (scene scripts)', system: SYSTEM,
    prompt: `Segment this script into exactly ${SCENE_COUNT} scene narrations for text-to-speech, one per scene. Scene 1 must begin with the hook. Keep the researcher's wording; only adjust what a speech engine would misread (spell out symbols, units and abbreviations, e.g. "%" → "percent").\n\n${scriptText(p.script!)}`,
    schema: strArray('scene_scripts'),
  }, (v) => (v.scene_scripts?.length !== SCENE_COUNT ? `need exactly ${SCENE_COUNT} scene scripts` : nonEmpty(v.scene_scripts, SCENE_COUNT, 'scene scripts')));
  return r.scene_scripts.map((s) => s.trim());
}

const VISUAL_RULES = 'Describe one concrete, drawable visual (subjects, composition, colours, a simple diagram or metaphor) in 1–3 sentences. Flat vector illustration style, vertical 9:16 frame, consistent palette across scenes, no real people\'s faces, no logos.';

/** model_1 generate~: scene_scripts -> visual_prompts* */
export async function generateVisualPrompts(p: Project, sceneScripts: string[]) {
  const r = await callModelValidated<{ visual_prompts: string[] }>({
    step: 'model_1 generate (visual prompts)', system: SYSTEM,
    prompt: `Paper: ${p.paper.title}\n\nWrite a visual prompt for each of these ${SCENE_COUNT} scenes, in order. ${VISUAL_RULES}\n\n${list(sceneScripts)}`,
    schema: strArray('visual_prompts'),
  }, (v) => (v.visual_prompts?.length !== SCENE_COUNT ? `need exactly ${SCENE_COUNT} visual prompts` : nonEmpty(v.visual_prompts, SCENE_COUNT, 'visual prompts')));
  return r.visual_prompts.map((s) => s.trim());
}

/** model_1 generate~ (process 6): edited scene script -> updated visual prompt for that scene */
export async function regenerateVisualPrompt(p: Project, scene: Scene) {
  const all = p.scenes!.map((s) => s.script);
  const r = await callModelValidated<{ visual_prompt: string }>({
    step: 'model_1 generate (revised visual prompt)', system: SYSTEM,
    prompt: `Paper: ${p.paper.title}\n\nAll scene narrations:\n${list(all)}\n\nThe researcher rewrote scene ${scene.index + 1}. Its previous visual prompt was:\n${scene.visualPrompt}\n\nWrite an updated visual prompt that matches the new narration of scene ${scene.index + 1}, keeping the visual style consistent with the previous prompt. ${VISUAL_RULES}`,
    schema: { type: 'object', properties: { visual_prompt: { type: 'string' } }, required: ['visual_prompt'] },
  }, (v) => (!v.visual_prompt?.trim() ? 'empty visual prompt' : null));
  return r.visual_prompt.trim();
}

export async function prepareStoryboard(p: Project, stage: (s: string) => void) {
  stage('Segmenting the script into scenes');
  const sceneScripts = await decomposeScript(p);
  stage('Writing visual prompts');
  const prompts = await generateVisualPrompts(p, sceneScripts);
  fs.rmSync(path.join(projectDir(p.id), 'scenes'), { recursive: true, force: true });
  p.scenes = sceneScripts.map((script, index) => ({
    index, script, scriptVersion: 1, visualPrompt: prompts[index], visualPromptVersion: 1, status: 'idle', clips: [], activeClip: null,
  }));
  p.storyboardFromScript = JSON.stringify(p.script);
  delete p.credits; delete p.approvedClips; delete p.finalVideoFile; delete p.creditClipFile;
}

/**
 * Shared scene production chain used by processes 4, 5 and 6:
 * model_3 generate~ -> tool_1 extract -> model_2 generate~ -> tool_2 compose.
 * Returns the new clip version (scene_clip / replacement_clip / revised_clip).
 */
async function produceScene(p: Project, scene: Scene, origin: ClipVersion['origin']): Promise<ClipVersion> {
  const version = (scene.clips.at(-1)?.version ?? 0) + 1;
  const dir = ensureDir(path.join(projectDir(p.id), 'scenes', String(scene.index), `v${version}`));
  const setStage = (s: string) => { scene.stage = s; saveProject(p); };
  setStage('Narrating (text-to-speech)');
  const audioFile = await synthesizeSpeech(p, scene.script, path.join(dir, 'audio.aiff'));
  setStage('Measuring narration');
  const duration = await measureDuration(audioFile);
  setStage('Generating visuals');
  const videoFile = await generateSceneVideo(scene.visualPrompt, duration, scene.index, dir);
  setStage('Adding voice and captions');
  const clipFile = await composeClip(dir, videoFile, audioFile, scene.script, duration);
  return { version, origin, sceneScript: scene.script, visualPrompt: scene.visualPrompt, audioFile, duration, videoFile, clipFile, createdAt: new Date().toISOString() };
}

/** tool_1 modify: put the new clip into scene_clips (earlier versions kept). */
function replaceClip(p: Project, scene: Scene, clip: ClipVersion) {
  scene.clips.push(clip);
  scene.activeClip = clip.version;
  delete p.finalVideoFile;
}

/** Run a scene job in the background with per-scene status. */
export function runSceneJob(p: Project, scene: Scene, fn: () => Promise<void>) {
  if (scene.status === 'working') throw new Error(`Scene ${scene.index + 1} is already being generated`);
  scene.status = 'working'; scene.error = undefined; scene.stage = 'queued';
  saveProject(p);
  return fn()
    .then(() => { scene.status = 'done'; })
    .catch((e) => { console.error(e); scene.status = 'error'; scene.error = e.message; })
    .finally(() => {
      scene.stage = undefined; saveProject(p);
      maybePrepareCredits(p);
    });
}

/** process 4 (scene_request = all | one) */
export function generateScenes(p: Project, which: 'all' | number) {
  const targets = which === 'all' ? p.scenes!.filter((s) => s.status !== 'working') : [p.scenes![which]];
  for (const s of targets) runSceneJob(p, s, async () => replaceClip(p, s, await produceScene(p, s, 'generate')));
}

/** process 5: regenerate the selected scene from the same script and prompt. */
export function regenerateScene(p: Project, index: number) {
  const s = p.scenes![index];
  runSceneJob(p, s, async () => replaceClip(p, s, await produceScene(p, s, 'regenerate')));
}

/** process 6: human modify scene script (v1 -> v2), new visual prompt, regenerate. */
export function reviseScene(p: Project, index: number, newScript: string) {
  const s = p.scenes![index];
  runSceneJob(p, s, async () => {
    s.script = newScript.trim(); s.scriptVersion++;
    s.stage = 'Updating visual prompt'; saveProject(p);
    s.visualPrompt = await regenerateVisualPrompt(p, s); s.visualPromptVersion++;
    replaceClip(p, s, await produceScene(p, s, 'revise'));
  });
}

/** Revert a scene to an earlier clip version (keeps the loop's earlier rounds usable). */
export function restoreClip(p: Project, index: number, version: number) {
  const s = p.scenes![index];
  const c = s.clips.find((x) => x.version === version);
  if (!c) throw new Error('No such version');
  s.activeClip = version; s.script = c.sceneScript; s.visualPrompt = c.visualPrompt;
  delete p.finalVideoFile;
}

export const activeClip = (s: Scene) => s.clips.find((c) => c.version === s.activeClip);

// ================================================================ process 7: credits and final merge

const allClipsReady = (p: Project) => !!p.scenes?.length && p.scenes.every((s) => s.activeClip !== null && s.status !== 'working');

/** Trigger: once storyboard clips are complete, prepare the credit scene. */
export function maybePrepareCredits(p: Project) {
  if (!allClipsReady(p) || p.credits) return;
  prepareCredits(p).then(() => saveProject(p)).catch((e) => { p.error = `Credits failed: ${e.message}`; saveProject(p); });
}

export async function prepareCredits(p: Project) {
  const dir = ensureDir(path.join(projectDir(p.id), 'credits'));
  const pdf = path.join(projectDir(p.id), 'paper.pdf');
  const screenshotFile = await extractScreenshot(pdf, dir);                // tool_1 extract
  const authors = await extractAuthors(pdf, p.paper.title);               // tool_1 extract
  const creditText = composeCreditText(p.paper.title, authors);           // tool_1 compose
  p.credits = { screenshotFile, authors, creditText, creditTextVersion: 1 };
  p.credits.creditSceneFile = renderCreditScene(screenshotFile, creditText, path.join(dir, 'credit_scene_v1.png')); // tool_1 compose
  p.approvedClips = p.scenes!.map((s) => s.index);
}

/** human modify credit_text -> tool_1 compose credit_scene */
export function updateCreditText(p: Project, text: string) {
  const c = p.credits!;
  c.creditText = text; c.creditTextVersion++;
  c.creditSceneFile = renderCreditScene(c.screenshotFile, text, path.join(projectDir(p.id), 'credits', `credit_scene_v${c.creditTextVersion}.png`));
  delete p.finalVideoFile;
}

/** merge_request: tool_2 translate (credit scene -> clip) then tool_2 compose (final_video). */
export async function mergeFinal(p: Project, approved: number[], stage: (s: string) => void) {
  const clips = p.scenes!.filter((s) => approved.includes(s.index)).map((s) => activeClip(s)?.clipFile).filter((f): f is string => !!f);
  if (!clips.length) throw new Error('Approve at least one scene');
  p.approvedClips = approved;
  const dir = path.join(projectDir(p.id), 'final');
  ensureDir(dir);
  stage('Turning the credit screen into a clip');
  const creditPng = path.join(dir, 'credit_scene.png');
  fs.copyFileSync(p.credits!.creditSceneFile!, creditPng);
  p.creditClipFile = await stillToClip(creditPng, path.join(dir, 'credit_clip.mp4'));
  stage('Merging clips');
  p.finalVideoFile = await concatClips([...clips, p.creditClipFile], path.join(dir, `final_video_${Date.now()}.mp4`));
}
