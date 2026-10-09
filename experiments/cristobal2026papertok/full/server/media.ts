// model_2 (video generation), model_3 (text-to-speech), tool_1 extract duration,
// tool_1 compose credit scene, tool_2 (video editing and concatenation).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { Resvg } from '@resvg/resvg-js';
import { callModelValidated } from './model.ts';
import { captionChunks, ensureDir, wrap } from './tools.ts';
import type { Project } from './types.ts';

const run = promisify(execFile);
const FFMPEG = (ffmpegPath as unknown as string) ?? 'ffmpeg';
export const W = 720, H = 1280, FPS = 30;
const TAIL = 0.35; // seconds of breathing room after each scene's narration
const FONT = process.env.CAPTION_FONT ?? '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

async function ffmpeg(args: string[], cwd?: string) {
  try {
    await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd, maxBuffer: 1 << 24 });
  } catch (e: any) {
    throw new Error(`ffmpeg failed: ${(e.stderr || e.message).toString().slice(0, 600)}`);
  }
}

// ---------------------------------------------------------------- model_3: text-to-speech

const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Princess)\b/;

let voiceCache: string[] | null = null;
export async function englishVoices(): Promise<string[]> {
  if (voiceCache) return voiceCache;
  const { stdout } = await run('say', ['-v', '?']);
  voiceCache = stdout.split('\n')
    .map((l) => l.match(/^(.+?)\s{2,}(en_[A-Z]{2})\s+#/))
    .filter((m): m is RegExpMatchArray => !!m && !NOVELTY.test(m[1]))
    .map((m) => m[1].trim());
  return voiceCache;
}

/** The TTS model step: voice_style + text -> audio. Settings are derived from voice_style once and cached. */
const pendingSettings = new Map<string, Promise<{ voice: string; rate: number }>>();

export async function synthesizeSpeech(p: Project, text: string, outFile: string) {
  const voiceStyle = p.voiceStyle!;
  if (!p.ttsSettings || p.ttsSettings.forVoiceStyle !== voiceStyle) {
    // Scenes are produced in parallel: share one settings call per voice style so every scene uses the same voice.
    const key = `${p.id}\n${voiceStyle}`;
    if (!pendingSettings.has(key)) pendingSettings.set(key, chooseVoiceSettings(voiceStyle).finally(() => setTimeout(() => pendingSettings.delete(key), 1000)));
    const s = await pendingSettings.get(key)!;
    p.ttsSettings = { forVoiceStyle: voiceStyle, voice: s.voice, rate: Math.round(s.rate) };
  }
  const txt = outFile.replace(/\.\w+$/, '.txt');
  fs.writeFileSync(txt, text);
  await run('say', ['-v', p.ttsSettings.voice, '-r', String(p.ttsSettings.rate), '-f', txt, '-o', outFile]);
  return outFile;
}

async function chooseVoiceSettings(voiceStyle: string) {
  const voices = await englishVoices();
  return callModelValidated<{ voice: string; rate: number }>({
      step: 'model_3 generate (voice settings)',
      system: 'You configure a text-to-speech engine. Answer only with the requested JSON.',
      prompt: `Pick the installed voice and speaking rate (words per minute) that best realise this narration style for a short science video.\n\nNarration style:\n${voiceStyle}\n\nInstalled voices: ${voices.join(', ')}\n\nRate must be between 150 and 260; fast-paced styles should be 185 or more.`,
      schema: { type: 'object', properties: { voice: { type: 'string' }, rate: { type: 'number' } }, required: ['voice', 'rate'] },
    }, (v) => (!voices.includes(v.voice) ? `voice must be one of the installed voices` : v.rate < 150 || v.rate > 260 ? 'rate out of range' : null));
}

// ---------------------------------------------------------------- tool_1 extract: duration

export async function measureDuration(file: string): Promise<number> {
  try {
    await run(FFMPEG, ['-hide_banner', '-i', file]);
  } catch (e: any) {
    const m = String(e.stderr).match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  throw new Error(`could not measure duration of ${path.basename(file)}`);
}

// ---------------------------------------------------------------- model_2: video generation

export function sanitizeSvg(svg: string) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/(xlink:)?href\s*=\s*["'](https?:|file:)[^"']*["']/gi, '');
}

export function renderSvg(svg: string, width: number) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' }, background: '#000' });
  return r.render().asPng();
}

function fallbackSvg(prompt: string, hue: number) {
  const lines = wrap(prompt.slice(0, 160), 26).split('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,30%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,12%)"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="360" cy="420" r="180" fill="hsl(${hue},70%,60%)" opacity="0.35"/>${lines.map((l, i) => `<text x="360" y="${380 + i * 44}" font-size="34" fill="#fff" text-anchor="middle" font-family="Helvetica">${escapeXml(l)}</text>`).join('')}</svg>`;
}

/**
 * model_2 generate: visual prompt + narration duration -> silent video timed to the narration.
 * The model draws SVG keyframes; they are animated with slow camera moves to the exact duration.
 */
export async function generateSceneVideo(visualPrompt: string, duration: number, sceneIndex: number, dir: string) {
  const n = Math.max(1, Math.min(3, Math.ceil(duration / 4.5)));
  let keyframes: string[];
  try {
    const out = await callModelValidated<{ keyframes: { svg: string }[] }>({
      step: 'model_2 generate (scene visuals)',
      system: 'You are a motion designer who draws vertical (9:16) illustrations for short science videos as standalone SVG code.',
      prompt: `Draw ${n} keyframe(s) for one scene of a short vertical science video. The keyframes are shown in order, each for about ${(duration / n).toFixed(1)} seconds, with slow camera motion added afterwards; together they last ${duration.toFixed(1)} s.\n\nVisual prompt:\n${visualPrompt}\n\nRequirements for every keyframe:\n- a complete <svg> element with xmlns="http://www.w3.org/2000/svg" and viewBox="0 0 ${W} ${H}"\n- a full-bleed background (gradients welcome), bold simple shapes, icons and diagrams built from primitives; consistent palette across keyframes; later keyframes should progress the idea, not repeat it\n- no external images, fonts, scripts, filters or animations\n- keep the bottom 420 px free of text (captions are added there); at most 6 words of on-screen text per keyframe, font-family Helvetica, size 40 or larger`,
      schema: { type: 'object', properties: { keyframes: { type: 'array', items: { type: 'object', properties: { svg: { type: 'string' } }, required: ['svg'] } } }, required: ['keyframes'] },
      timeoutMs: 6 * 60_000,
    }, (v) => {
      if (!Array.isArray(v.keyframes) || v.keyframes.length < 1) return 'no keyframes';
      for (const [i, k] of v.keyframes.entries()) {
        if (!/^\s*<svg[\s>]/.test(k.svg)) return `keyframe ${i + 1} is not an <svg> element`;
        try { renderSvg(sanitizeSvg(k.svg), 64); } catch (e: any) { return `keyframe ${i + 1} does not render: ${e.message}`; }
      }
      return null;
    });
    keyframes = out.keyframes.slice(0, 3).map((k) => sanitizeSvg(k.svg));
  } catch (e) {
    console.warn('[model_2] falling back to a title card:', (e as Error).message);
    keyframes = [fallbackSvg(visualPrompt, (sceneIndex * 47) % 360)];
  }
  const pngs = keyframes.map((svg, i) => {
    const f = path.join(dir, `keyframe_${i}.png`);
    fs.writeFileSync(path.join(dir, `keyframe_${i}.svg`), svg);
    fs.writeFileSync(f, renderSvg(svg, 1080));
    return f;
  });
  const totalFrames = Math.ceil((duration + TAIL) * FPS);
  const per = Math.ceil(totalFrames / pngs.length);
  const moves = [
    { z: `1+0.12*on/${per}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
    { z: `1.12-0.12*on/${per}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
    { z: '1.1', x: 'iw/2-(iw/zoom/2)', y: `(ih-ih/zoom)*(1-on/${per})` },
  ];
  const parts = pngs.map((_, i) => {
    const m = moves[(i + sceneIndex) % moves.length];
    return `[${i}:v]scale=1080:1920,zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${per}:s=${W}x${H}:fps=${FPS},setsar=1[v${i}]`;
  });
  const filter = `${parts.join(';')};${pngs.map((_, i) => `[v${i}]`).join('')}concat=n=${pngs.length}:v=1:a=0,format=yuv420p[out]`;
  const out = path.join(dir, 'video.mp4');
  await ffmpeg([...pngs.flatMap((f) => ['-i', path.basename(f)]), '-filter_complex', filter, '-map', '[out]', '-frames:v', String(totalFrames), '-c:v', 'libx264', '-preset', 'veryfast', '-r', String(FPS), path.basename(out)], dir);
  return out;
}

// ---------------------------------------------------------------- tool_2 compose: video + voice + captions

export async function composeClip(dir: string, videoFile: string, audioFile: string, narration: string, duration: number) {
  const chunks = captionChunks(narration, duration);
  // One drawtext per caption line so every line is centred on its own.
  const draws = chunks.flatMap((c, i) => c.text.split('\n').map((line, j) => {
    const f = `caption_${i}_${j}.txt`;
    fs.writeFileSync(path.join(dir, f), line);
    return `drawtext=fontfile='${FONT}':textfile=${f}:expansion=none:fontsize=50:fontcolor=white:borderw=5:bordercolor=black@0.85:x=(w-text_w)/2:y=h*0.74+${j * 62}:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'`;
  }));
  const vf = draws.length ? `[0:v]${draws.join(',')}[v]` : '[0:v]null[v]';
  const filter = `${vf};[1:a]aresample=44100,apad[a]`;
  const out = path.join(dir, 'clip.mp4');
  await ffmpeg(['-i', path.basename(videoFile), '-i', path.basename(audioFile), '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
    '-t', (duration + TAIL).toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', path.basename(out)], dir);
  return out;
}

// ---------------------------------------------------------------- tool_1 compose: credit scene

export function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderCreditScene(screenshotFile: string, creditText: string, outFile: string) {
  const png = fs.readFileSync(screenshotFile).toString('base64');
  const lines = creditText.split('\n').flatMap((l) => (l.trim() ? wrap(l.trim(), 34).split('\n') : ['']));
  const textSvg = lines.slice(0, 9).map((l, i) =>
    `<text x="360" y="${110 + i * 46}" font-size="${i === 0 ? 30 : 34}" fill="${i === 0 ? '#9fb3c8' : '#fff'}" text-anchor="middle" font-family="Helvetica" font-weight="${i === 0 ? 'normal' : 'bold'}">${escapeXml(l)}</text>`).join('');
  const top = 110 + Math.min(lines.length, 9) * 46 + 20;
  const imgH = H - top - 60;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0f1b2d"/>
${textSvg}
<rect x="76" y="${top - 4}" width="568" height="${imgH + 8}" fill="#fff" rx="6"/>
<image x="80" y="${top}" width="560" height="${imgH}" preserveAspectRatio="xMidYMin meet" href="data:image/png;base64,${png}"/>
</svg>`;
  fs.writeFileSync(outFile, renderSvg(svg, W));
  return outFile;
}

// ---------------------------------------------------------------- tool_2 translate / compose: final video

export async function stillToClip(png: string, outFile: string, seconds = 4) {
  const dir = path.dirname(outFile);
  await ffmpeg(['-loop', '1', '-i', path.basename(png), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(seconds),
    '-vf', `scale=${W}:${H},format=yuv420p`, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', path.basename(outFile)], dir);
  return outFile;
}

export async function concatClips(clips: string[], outFile: string) {
  const dir = ensureDir(path.dirname(outFile));
  const list = path.join(dir, 'concat.txt');
  fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', path.basename(outFile)], dir);
  return outFile;
}

