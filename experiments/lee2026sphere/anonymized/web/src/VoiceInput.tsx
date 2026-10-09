// human specify → r17 (instruction audio); model_1 translate → r18 (instruction language).
// model_1 is the browser's speech-recognition model (Web Speech API); Claude cannot take audio.
import { useEffect, useRef, useState } from 'react';

interface Props { onCommand: (transcript: string) => void; disabled: boolean; hasSelection: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SR: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export function VoiceInput({ onCommand, disabled, hasSelection }: Props) {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null); // r17
  const [transcript, setTranscript] = useState(''); // r18
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const recog = useRef<any>(null);
  const finalText = useRef('');

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const start = async () => {
    if (disabled || recording) return;
    setError(null); setInterim(''); finalText.current = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setAudioUrl(URL.createObjectURL(new Blob(chunks, { type: mr.mimeType }))); };
      mr.start(); rec.current = mr;
    } catch { setError('Microphone unavailable — type the command instead.'); }
    if (SR) {
      const r = new SR();
      r.lang = 'en-US'; r.interimResults = true; r.continuous = true;
      r.onresult = (e: any) => {
        let fin = '', tmp = '';
        for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
        finalText.current = fin; setInterim(fin + tmp);
      };
      r.onerror = (e: any) => setError(`Speech recognition: ${e.error}`);
      r.start(); recog.current = r;
    } else setError('This browser has no speech recognition — the audio is recorded; type what you said below.');
    setRecording(true);
  };

  const stop = () => {
    if (!recording) return;
    setRecording(false);
    rec.current?.stop();
    const r = recog.current;
    if (r) {
      r.onend = () => { const t = (finalText.current || interim).trim(); setTranscript(t); setInterim(''); if (t) onCommand(t); };
      r.stop();
    }
  };

  return (
    <div className="voice">
      <button
        className={`mic ${recording ? 'on' : ''}`} disabled={disabled}
        onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}
        title="Hold to speak a command about the selection"
      >{recording ? '● Listening…' : '🎤 Hold to speak'}</button>
      <form className="typed" onSubmit={(e) => { e.preventDefault(); if (transcript.trim()) onCommand(transcript.trim()); }}>
        <input value={recording ? interim : transcript} onChange={(e) => setTranscript(e.target.value)} disabled={disabled || recording}
          placeholder={hasSelection ? 'e.g. "turn these to face the window" or "move this closer to the sofa"' : 'Select objects on the plan, then speak or type a command'} />
        <button disabled={disabled || recording || !transcript.trim()}>Apply</button>
      </form>
      {audioUrl && <audio className="clip" src={audioUrl} controls title="Last recorded command (r17)" />}
      {error && <div className="warn">{error}</div>}
    </div>
  );
}
