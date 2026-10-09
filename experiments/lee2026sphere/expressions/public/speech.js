// [human specify] speech_1 (audio) and [model_1 translate] speech_1 -> transcript_1.
// model_1 is the browser's speech-recognition model (Web Speech API): the Claude CLI cannot transcribe audio.
// Swap transcription providers by replacing createTranscriber().

function createTranscriber() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = '', interim = '', onUpdate = () => {}, resolveDone;
  rec.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    onUpdate((finalText + interim).trim());
  };
  rec.onend = () => resolveDone?.((finalText + interim).trim());
  rec.onerror = (e) => { console.warn('speech recognition', e.error); resolveDone?.((finalText + interim).trim()); };
  return {
    start(cb) { finalText = ''; interim = ''; onUpdate = cb; rec.start(); },
    stop() { return new Promise((r) => { resolveDone = r; rec.stop(); }); },
  };
}

/** Push-to-talk recorder: records audio (speech_1) and transcribes it (transcript_1). */
export function createPushToTalk({ onInterim }) {
  const transcriber = createTranscriber();
  let recorder = null, chunks = [], stream = null, started = 0;
  return {
    available: !!transcriber,
    async start() {
      started = Date.now();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recorder = new MediaRecorder(stream);
        chunks = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.start();
      } catch (e) { console.warn('no microphone', e); recorder = null; }
      transcriber?.start(onInterim);
    },
    async stop() {
      const audio = await new Promise((resolve) => {
        if (!recorder) return resolve(null);
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.stop();
      });
      stream?.getTracks().forEach((t) => t.stop());
      const transcript = transcriber ? await transcriber.stop() : '';
      return { speech: audio, transcript, duration_ms: Date.now() - started };
    },
  };
}
