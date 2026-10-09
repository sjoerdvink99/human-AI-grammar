// Manual smoke test: model_2 + the full tool chain on sample lyrics.
import { generateSong } from "../server/music/generateSong.ts";
import { analyzeMusic } from "../server/tools/analysis.ts";
import { alignLyrics } from "../server/tools/align.ts";
import { extractBeats } from "../server/tools/beats.ts";

const lyrics = `[Verse 1]
I felt the floor begin to shake
A rhythm only I could take
The lights were dancing on the wall
I didn't need to hear at all
[Chorus]
Hold the light, hold it close
Feel the beat inside my bones
Every color, every sign
This music has always been mine
[Verse 2]
Hands that speak in silver air
Telling stories everywhere
They said that silence meant alone
But I have found a home
[Bridge]
Quiet is not empty
Quiet is a song`;
const t0 = Date.now();
const g = await generateSong(lyrics, "warm acoustic pop ballad, hopeful, 84 bpm, piano and acoustic guitar, soft bass, gentle drums, soft high female vocal", "smoketest");
console.log("generated", g, (Date.now() - t0) / 1000, "s");
const a = analyzeMusic(g.file, g.vocalStemFile, g.sungText);
console.log("words", a.predictedTranscript.words.length, "key", a.audioFeatures.key, a.audioFeatures.mode);
const tl = alignLyrics(lyrics, a.predictedTranscript);
console.log("lines", tl.lines.length, "match", tl.matchRate);
console.log(tl.lines.map((l) => `${l.start.toFixed(1)} ${l.section}: ${l.text}`).join("\n"));
const b = extractBeats(g.file);
console.log("tempo", b.tempo, "beats", b.rows.length);
