// model_1 translate: speech_1 (16 kHz mono PCM) → transcript_1 (automatic speech recognition).
import { localPipeline } from './transformers';

export const ASR_MODEL = process.env.ASR_MODEL ?? 'Xenova/whisper-tiny.en';

export async function transcribe(pcm16k: Float32Array): Promise<string> {
  if (pcm16k.length < 1600) throw new Error('recording too short');
  const asr = await localPipeline('automatic-speech-recognition', ASR_MODEL);
  const out = await asr(pcm16k, { chunk_length_s: 30 });
  return String(out.text ?? '').trim();
}

/** Loads both local models in the background so the first request is fast. */
export function warmUp() {
  localPipeline('automatic-speech-recognition', ASR_MODEL).catch((e) => console.warn('[model_1] could not load:', String(e)));
}
