import { useEffect, useState } from "react";
import { DEFAULT_VOICES, type VoiceSettings } from "../../../shared/types.ts";
import { get } from "../api.ts";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voice: "Samantha",
  rate: 150,
  pitch: "normal",
  tone: "warm and confident",
  pauses: "medium",
  emphasisWords: [],
};

let voicesPromise: Promise<string[]> | null = null;

/** r13 — the voice settings form (human specify in P3, human modify in P5). */
export function VoiceSettingsForm({ value, onChange, previous }: { value: VoiceSettings; onChange: (v: VoiceSettings) => void; previous?: VoiceSettings }) {
  const [voices, setVoices] = useState<string[]>(DEFAULT_VOICES);
  const [emph, setEmph] = useState(value.emphasisWords.join(", "));
  useEffect(() => {
    voicesPromise ??= get<string[]>("/api/voices").catch(() => DEFAULT_VOICES);
    voicesPromise.then(setVoices);
  }, []);
  useEffect(() => setEmph(value.emphasisWords.join(", ")), [value.emphasisWords]);
  const set = (patch: Partial<VoiceSettings>) => onChange({ ...value, ...patch });
  const changed = (k: keyof VoiceSettings) =>
    previous && JSON.stringify(previous[k]) !== JSON.stringify(value[k]) ? "changed" : "";

  return (
    <div className="form-grid">
      <label className={changed("voice")}>
        <span>Voice</span>
        <select value={value.voice} onChange={(e) => set({ voice: e.target.value })}>
          {[...new Set([value.voice, ...voices])].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className={changed("rate")}>
        <span>Pace: {value.rate} wpm</span>
        <input type="range" min={100} max={220} step={5} value={value.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
      </label>
      <div className={`field ${changed("pitch")}`}>
        <span>Pitch</span>
        <div className="seg">
          {(["lower", "normal", "higher"] as const).map((p) => (
            <button key={p} className={value.pitch === p ? "on" : ""} onClick={() => set({ pitch: p })}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className={`field ${changed("pauses")}`}>
        <span>Pauses</span>
        <div className="seg">
          {(["short", "medium", "long"] as const).map((p) => (
            <button key={p} className={value.pauses === p ? "on" : ""} onClick={() => set({ pauses: p })}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <label className={`span2 ${changed("tone")}`}>
        <span>Tone</span>
        <input value={value.tone} onChange={(e) => set({ tone: e.target.value })} placeholder="e.g. warm, playful, solemn" />
      </label>
      <label className={`span2 ${changed("emphasisWords")}`}>
        <span>Words to emphasise (comma-separated)</span>
        <input
          value={emph}
          onChange={(e) => setEmph(e.target.value)}
          onBlur={() => set({ emphasisWords: emph.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </label>
    </div>
  );
}
