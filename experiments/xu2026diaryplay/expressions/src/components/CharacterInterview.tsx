// Process 2: interview a character to discover traits.
// message (specify) → reply_1 (model) → reply_2 (human edit) → traits (model) → trait_choice (select) → characters_3 (modify)
import { useState } from "react";
import type { Update } from "../App";
import type { Character, Project } from "../shared/types";
import { api } from "../api";
import { useTask } from "../useTask";
import { Status } from "./WorldTab";

export default function CharacterInterview({ project: p, character, update }: { project: Project; character: Character; update: Update }) {
  const task = useTask();
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [originalReply, setOriginalReply] = useState<string | null>(null);
  const [traits, setTraits] = useState<string[]>([]);
  const [traitChoice, setTraitChoice] = useState<string | null>(null);
  const [traitDraft, setTraitDraft] = useState("");
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);

  // P2.1 [human specify] → P2.2 [model generate]~
  const ask = () =>
    task.run(`${character.name} is thinking…`, async () => {
      const r = await api<{ reply: string }>("interview-reply", { story: p.story, character, characters: p.characters, message });
      setReply(r.reply);
      setOriginalReply(r.reply);
      setTraits([]);
      setTraitChoice(null);
    });

  // P2.4 [model generate]~ from reply_2
  const suggest = () =>
    task.run("Reading between the lines…", async () => {
      const r = await api<{ traits: string[] }>("suggest-traits", { story: p.story, character, reply });
      setTraits(r.traits);
      setTraitChoice(null);
      setHistory((h) => [...h, { q: message, a: reply! }]);
    });

  // P2.6 [human modify] characters_2 → characters_3
  const addTrait = () => {
    const t = traitDraft.trim();
    if (!t) return;
    update((q) => ({
      characters: q.characters.map((c) => (c.id === character.id && !c.traits.includes(t) ? { ...c, traits: [...c.traits, t] } : c)),
    }));
    setTraits((ts) => ts.filter((x) => x !== traitChoice));
    setTraitChoice(null);
    setTraitDraft("");
  };

  return (
    <div className="step interview">
      <h3>Interview {character.name}</h3>
      <p className="muted">Ask a question, edit the answer until it sounds right, then pick a trait it reveals.</p>
      <Status task={task} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) ask();
        }}
      >
        <input className="grow" value={message} placeholder="e.g. What are you most afraid of?" onChange={(e) => setMessage(e.target.value)} />
        <button className="primary" disabled={!!task.busy || !message.trim()}>
          Ask
        </button>
      </form>

      {reply != null && (
        <>
          <label className="small">Answer (editable)</label>
          <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="row">
            {reply !== originalReply && <button onClick={() => setReply(originalReply)}>Revert edit</button>}
            <button disabled={!!task.busy} onClick={ask}>
              Regenerate answer
            </button>
            <button className="primary" disabled={!!task.busy || !reply.trim()} onClick={suggest}>
              Suggest traits
            </button>
          </div>
        </>
      )}

      {traits.length > 0 && (
        <>
          <div className="chips">
            {traits.map((t) => (
              <button
                key={t}
                className={`chip selectable ${traitChoice === t ? "active" : ""}`}
                onClick={() => {
                  setTraitChoice(t);
                  setTraitDraft(t);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {traitChoice && (
            <div className="row">
              <input className="grow" value={traitDraft} onChange={(e) => setTraitDraft(e.target.value)} />
              <button className="primary" onClick={addTrait}>
                Add to {character.name}
              </button>
            </div>
          )}
        </>
      )}

      {history.length > 0 && (
        <details>
          <summary>Earlier answers ({history.length})</summary>
          {history.map((h, i) => (
            <p key={i} className="small">
              <b>Q:</b> {h.q}
              <br />
              <b>A:</b> {h.a}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
