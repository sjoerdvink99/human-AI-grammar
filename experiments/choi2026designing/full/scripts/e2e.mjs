// Drives one full session through all processes against a running server.
const B = process.env.BASE ?? "http://localhost:3001";
const j = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(u + " " + JSON.stringify(d)); return d; };
const wait = async (id) => { for (;;) { const s = await j("GET", `/api/sessions/${id}`); if (!s.busy) { if (s.error) throw new Error("job error: " + s.error.message); return s; } await new Promise((r) => setTimeout(r, 1500)); } };
const last = (s) => s.feed[s.feed.length - 1];
const log = (label, x) => console.log(`\n=== ${label}\n${x}`);
let s = await j("POST", "/api/sessions"); s = await wait(s.id); log("Q", last(s).text);
const answers = [
  "I lost most of my hearing when I was 12, after an illness. It happened during my first year of secondary school.",
  "I felt isolated and angry for a long time, like the world went on without me. Now I feel more at peace, even proud.",
  "I want to make a song to show my younger self that it gets better. It's for me, and maybe for other deaf kids.",
  "I feel music through vibrations, I love strong bass and I watch lyrics videos. I like Billie Eilish and calm pop.",
  "I think that's everything I can share.", "Nothing more to add.", "That's it.", "Yes.", "Ok", "Ok"
];
let k = 0;
while (s.phase === "therapy") { s = await j("POST", `/api/sessions/${s.id}/therapy/answer`, { text: answers[k++] }); s = await wait(s.id); log(`after answer ${k} step=${s.stepStatus.currentStep} phase=${s.phase}`, last(s).text); }
log("vars", JSON.stringify(s.requiredVariables, null, 1));
log("lyric questions", s.lyricQuestions.join("\n"));
s = await j("POST", `/api/sessions/${s.id}/lyrics/inputs`, { answers: ["Loneliness turning into strength", "Sitting in class watching lips move, the window light on my desk", "vibration, light, hands, silence", "Silence is not empty"] });
s = await wait(s.id); log("concept", JSON.stringify(s.songConcept)); log("lyrics v1", s.lyrics[0].text);
s = await j("POST", `/api/sessions/${s.id}/lyrics/feedback`, { text: "Make the chorus mention feeling the bass in my chest." });
s = await wait(s.id); log("lyrics v2", s.lyrics[1].text);
s = await j("POST", `/api/sessions/${s.id}/lyrics/accept`); s = await wait(s.id); log("guidance", s.musicGuidance);
s = await j("POST", `/api/sessions/${s.id}/music/attributes`, { genre: "pop", mood: "empowering", tempo_bpm: 92, instruments: ["piano", "bass", "drums", "synth pad"], vocal: "soft high voice", notes: "strong bass I can feel" });
s = await wait(s.id); let song = s.songs.at(-1); log("song 1", `${song.audioUrl} ${song.duration.toFixed(1)}s style="${song.stylePrompt}" match=${song.timedLyrics.matchRate} tempo=${song.beatFeatures.tempo} lines=${song.timedLyrics.lines.length}`); log("review q", s.reviewQuestion);
s = await j("POST", `/api/sessions/${s.id}/song/feedback`, { satisfied: false, text: "It's a bit slow, I want it more energetic." }); log("phase", s.phase);
s = await j("POST", `/api/sessions/${s.id}/music/attributes`, { ...s.musicAttributes.at(-1), tempo_bpm: 118, mood: "joyful", instruments: ["acoustic guitar", "bass", "drums", "bells"] });
s = await wait(s.id); song = s.songs.at(-1); log("song 2", `${song.audioUrl} ${song.duration.toFixed(1)}s style="${song.stylePrompt}" match=${song.timedLyrics.matchRate} tempo=${song.beatFeatures.tempo}`); log("review q2", s.reviewQuestion);
s = await j("POST", `/api/sessions/${s.id}/song/feedback`, { satisfied: true, text: "Yes! I could feel it." }); s = await wait(s.id); log("reflection q", s.reflectionQuestion);
s = await j("POST", `/api/sessions/${s.id}/reflection`, { text: "The line about silence not being empty made me cry a bit. I remember sitting alone at lunch." });
s = await wait(s.id); log("supportive", s.supportiveResponse); log("final phase", s.phase + " session " + s.id);
