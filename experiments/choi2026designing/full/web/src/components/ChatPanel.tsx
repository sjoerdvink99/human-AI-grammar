import { useEffect, useRef, useState } from "react";
import { api, type Session } from "../api.ts";

type Act = (fn: () => Promise<Session>) => Promise<void>;

const BUSY_ICON: Record<string, string> = {
  "model_1 extract": "📝",
  "model_1 generate": "💬",
  "model_1 modify": "✏️",
  "model_1 translate": "🎛️",
  "model_2 generate": "🎵",
  "tool_1 evaluate": "✅",
  "tool_2 extract": "📈",
  "tool_3 match": "🔗",
  "tool_4 extract": "🥁",
  "tool_5 translate": "🎨",
};

export function ChatPanel({ session, act }: { session: Session; act: Act }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [session.feed.length, session.busy]);

  const busy = !!session.busy;
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    if (session.phase === "therapy") await act(() => api.answer(session.id, text));
    else if (session.phase === "reflection") await act(() => api.reflection(session.id, text));
    setDraft("");
  };
  const textInput = session.phase === "therapy" || session.phase === "reflection";
  const placeholder = session.phase === "reflection" ? "Share your reflection…" : "Type your answer… (you can always say you'd rather not share)";

  return (
    <section className="chat" aria-label="Conversation">
      <div className="feed" aria-live="polite">
        {session.feed.map((f, i) => (
          <div key={i} className={`bubble ${f.role} kind-${f.kind}`}>
            {f.kind === "lyric_questions" ? (
              <>
                <p>Let's shape your song. Answer any of these questions below:</p>
                <ol>{session.lyricQuestions.map((q, k) => <li key={k}>{q}</li>)}</ol>
              </>
            ) : (
              f.text.split("\n").map((p, k) => <p key={k}>{p}</p>)
            )}
          </div>
        ))}
        {busy && (
          <div className="bubble assistant typing" role="status">
            <span className="op-icon" aria-hidden>{BUSY_ICON[session.busy!.op] ?? "…"}</span>
            <span>{session.busy!.label}</span>
            <span className="dots"><i /><i /><i /></span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {session.phase === "lyric_questions" && session.lyricQuestions.length > 0 && !busy && (
        <LyricQuestionsForm session={session} act={act} />
      )}

      {textInput && session.phase !== "done" && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={3}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="primary" disabled={busy || !draft.trim()}>Send</button>
        </form>
      )}
      {session.phase === "done" && <p className="done-note">Thank you for writing this song. Your session is saved.</p>}
    </section>
  );
}

/** Process 2 — human specify: answers to the lyric questions become lyric_inputs. */
function LyricQuestionsForm({ session, act }: { session: Session; act: Act }) {
  const [answers, setAnswers] = useState<string[]>(() => session.lyricQuestions.map(() => ""));
  return (
    <form
      className="lyric-questions"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => api.lyricInputs(session.id, answers));
      }}
    >
      {session.lyricQuestions.map((q, i) => (
        <label key={i}>
          <span>{q}</span>
          <textarea
            rows={2}
            value={answers[i]}
            onChange={(e) => setAnswers(answers.map((a, k) => (k === i ? e.target.value : a)))}
          />
        </label>
      ))}
      <button className="primary" disabled={!answers.some((a) => a.trim())}>Write my lyrics</button>
    </form>
  );
}
