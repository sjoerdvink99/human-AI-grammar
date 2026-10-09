// P3.3 [human specify] — record a voice note (instruction audio) for one box.
// Audio is captured with MediaRecorder; a live transcript is captured with the browser's
// SpeechRecognition where available. Without it, the user types what they said.
import { useEffect, useRef, useState } from "react";
import type { VoiceNote } from "../shared/types";

type SR = { start(): void; stop(): void; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; continuous: boolean; interimResults: boolean; lang: string };
const SpeechRec: (new () => SR) | undefined = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
export const speechSupported = !!SpeechRec;

export function VoiceRecorder({ boxId, note, onChange }: { boxId: string; note?: VoiceNote; onChange: (n: VoiceNote) => void }) {
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const sr = useRef<SR | null>(null);
  const transcript = useRef("");

  useEffect(() => () => { rec.current?.stop(); sr.current?.stop(); }, []);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const url = URL.createObjectURL(new Blob(chunks, { type: mr.mimeType }));
        // Give the recogniser a moment to deliver its final result.
        setTimeout(() => onChange({ boxId, audioUrl: url, transcript: transcript.current.trim() }), 400);
      };
      transcript.current = "";
      if (SpeechRec) {
        const r = new SpeechRec();
        r.continuous = true; r.interimResults = false; r.lang = navigator.language || "en-US";
        r.onresult = (e: any) => {
          transcript.current = Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(" ");
        };
        r.onerror = (e: any) => setErr(`speech recognition: ${e.error}`);
        r.start();
        sr.current = r;
      }
      mr.start();
      rec.current = mr;
      setRecording(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const stop = () => { sr.current?.stop(); rec.current?.stop(); setRecording(false); };

  return (
    <div className="voice">
      {recording ? <button className="rec on" onClick={stop}>■ Stop</button> : <button className="rec" onClick={start}>● {note?.audioUrl ? "Re-record" : "Record"}</button>}
      {note?.audioUrl && !recording && <audio src={note.audioUrl} controls />}
      {(note?.audioUrl || !speechSupported) && (
        <input
          className="transcript"
          placeholder={speechSupported ? "transcript" : "no speech recognition — type what you said"}
          value={note?.transcript ?? ""}
          onChange={(e) => onChange({ boxId, audioUrl: note?.audioUrl ?? null, transcript: e.target.value })}
        />
      )}
      {err && <span className="err">{err}</span>}
    </div>
  );
}
