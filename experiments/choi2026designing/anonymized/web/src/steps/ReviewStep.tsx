// Process 4: review and coaching.
// (r15 + r20 + r10) → [model_1 generate]~ → r21 → [human evaluate] → r22 → [model_1 generate]~ → r23
//   → [human specify] → r24 → [model_1 generate]~ → r25
// Process 5: re-take.
// (r15 + r10 + r13 + r22) → [human modify] → r13_2 → take pipeline (take.ts) → r15_2 + r20_2
import { useEffect, useRef, useState } from "react";
import type { Take, VoiceSettings } from "../../../shared/types.ts";
import { post } from "../api.ts";
import type { StepProps } from "../App.tsx";
import { useBusy, type Project, type TakeReview } from "../state.ts";
import { Pipeline, Prose } from "../components/Pipeline.tsx";
import { VoiceSettingsForm } from "../components/VoiceSettingsForm.tsx";
import { TAKE_PIPELINE, recordTake } from "../take.ts";

export function ReviewStep({ project, update }: StepProps) {
  const take = project.takes.find((t) => t.id === project.activeTakeId) ?? project.takes[project.takes.length - 1];
  const review: TakeReview = project.reviews[take.id] ?? { qa: [] };
  const { busy, error, run } = useBusy();
  const [feedback, setFeedback] = useState(review.feedback ?? "");
  const [question, setQuestion] = useState("");
  const [compareId, setCompareId] = useState<string>("");
  const [retake, setRetake] = useState<VoiceSettings>(take.voiceSettings);
  const [stage, setStage] = useState(-1);
  const analysed = useRef(new Set<string>());

  const setReview = (id: string, patch: Partial<TakeReview>) =>
    update((p) => ({ ...p, reviews: { ...p.reviews, [id]: { ...(p.reviews[id] ?? { qa: [] }), ...patch } } }));

  useEffect(() => {
    setFeedback(review.feedback ?? "");
    setRetake(take.voiceSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.id]);

  const analyse = (t: Take) =>
    run("analysis", async () => {
      const { analysis } = await post<{ analysis: string }>("/api/delivery-analysis", {
        script: t.script,
        duration: t.duration,
        wordFeatures: t.wordFeatures,
      });
      setReview(t.id, { analysis });
    });

  // Triggered by a new take arriving (or opening a take that has no analysis yet).
  useEffect(() => {
    if (!review.analysis && !analysed.current.has(take.id)) {
      analysed.current.add(take.id);
      analyse(take);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.id]);

  const coach = () =>
    run("coach", async () => {
      setReview(take.id, { feedback, tips: undefined });
      const { tips } = await post<{ tips: string }>("/api/coaching", {
        script: take.script,
        duration: take.duration,
        wordFeatures: take.wordFeatures,
        feedback,
      });
      setReview(take.id, { feedback, tips });
    });

  const ask = () =>
    run("ask", async () => {
      const q = question.trim();
      const qa = [...review.qa, { question: q }];
      setReview(take.id, { qa });
      setQuestion("");
      const { answer } = await post<{ answer: string }>("/api/coach-answer", { question: q });
      setReview(take.id, { qa: qa.map((x, i) => (i === qa.length - 1 ? { ...x, answer } : x)) });
    });

  const doRetake = () =>
    run("retake", async () => {
      const t = await recordTake(take.script, retake, project.takes.length + 1, setStage);
      update((p: Project) => ({
        ...p,
        voiceSettings: retake,
        takes: [...p.takes, t],
        activeTakeId: t.id,
        reviews: { ...p.reviews, [t.id]: { qa: [] } },
      }));
      setCompareId(take.id);
    }).finally(() => setStage(-1));

  const compare = project.takes.find((t) => t.id === compareId && t.id !== take.id);
  const hasFeedback = !!review.feedback?.trim();

  return (
    <section className="step">
      <header>
        <h2>4 · Review & coach</h2>
        <div className="tabs">
          {project.takes.map((t) => (
            <button
              key={t.id}
              className={t.id === take.id ? "tab active" : "tab"}
              onClick={() => update((p) => ({ ...p, activeTakeId: t.id }))}
            >
              Take {t.version}
            </button>
          ))}
        </div>
      </header>

      <TakeView take={take} />
      {compare && (
        <div className="compare">
          <div className="card-head">
            <h3>Comparing with take {compare.version}</h3>
            <button className="link" onClick={() => setCompareId("")}>
              close
            </button>
          </div>
          <TakeView take={compare} compact />
        </div>
      )}
      {project.takes.length > 1 && !compare && (
        <label className="inline">
          Compare with{" "}
          <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
            <option value="">—</option>
            {project.takes
              .filter((t) => t.id !== take.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  Take {t.version}
                </option>
              ))}
          </select>
        </label>
      )}

      {error && <div className="error">{error}</div>}

      <div className="two-col">
        <div className="col">
          <div className="card ai">
            <div className="card-head">
              <h3>Delivery analysis</h3>
              <button className="link" disabled={busy.analysis} onClick={() => analyse(take)}>
                ↻ Regenerate
              </button>
            </div>
            {busy.analysis ? <div className="skeleton">Analysing the take…</div> : <Prose text={review.analysis ?? "—"} />}
          </div>

          <div className="card">
            <h3>Your feedback on take {take.version}</h3>
            <textarea
              rows={4}
              value={feedback}
              placeholder="How did it sound to you? e.g. Too fast in the middle, the joke doesn't land, ending feels flat."
              onChange={(e) => setFeedback(e.target.value)}
            />
            <button className="primary" disabled={!feedback.trim() || busy.coach} onClick={coach}>
              {busy.coach ? "Coaching…" : "Get coaching tips"}
            </button>
          </div>

          {(review.tips || busy.coach) && (
            <div className="card ai">
              <h3>Coaching tips</h3>
              {busy.coach ? <div className="skeleton">Writing tips…</div> : <Prose text={review.tips!} />}
            </div>
          )}

          {review.tips && (
            <div className="card">
              <h3>Ask the coach</h3>
              {review.qa.map((x, i) => (
                <div key={i} className="qa">
                  <div className="bubble user">{x.question}</div>
                  <div className="bubble assistant">{x.answer ? <Prose text={x.answer} /> : <span className="spinner" />}</div>
                </div>
              ))}
              <p className="muted small">The coach sees only your question, so make it self-contained.</p>
              <div className="composer">
                <textarea
                  rows={2}
                  value={question}
                  placeholder="e.g. How do I stop rushing when I'm nervous?"
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <button disabled={!question.trim() || busy.ask} onClick={ask}>
                  Ask
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="col">
          <div className={`card ${hasFeedback ? "" : "disabled"}`}>
            <h3>Adjust voice & re-take</h3>
            {!hasFeedback ? (
              <p className="muted">Write your feedback first; you will adjust the voice settings against it.</p>
            ) : (
              <>
                <blockquote className="feedback-quote">{review.feedback}</blockquote>
                <VoiceSettingsForm value={retake} previous={take.voiceSettings} onChange={setRetake} />
                <button
                  className="primary wide"
                  disabled={busy.retake || JSON.stringify(retake) === JSON.stringify(take.voiceSettings)}
                  onClick={doRetake}
                >
                  {busy.retake ? "Recording…" : `Record take ${project.takes.length + 1}`}
                </button>
                {stage >= 0 && <Pipeline steps={TAKE_PIPELINE} current={stage} />}
              </>
            )}
          </div>
          <details className="card">
            <summary>Voice direction used for take {take.version}</summary>
            <p>{take.voiceDirection}</p>
            {take.speechFallback && <p className="warn small">The speech model changed the script's words, so the plain script was rendered.</p>}
          </details>
        </div>
      </div>
    </section>
  );
}

function TakeView({ take, compact }: { take: Take; compact?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(0);
  const seek = (s: number) => {
    if (audio.current) {
      audio.current.currentTime = s;
      audio.current.play();
    }
  };
  const s = take.voiceSettings;
  const current = take.wordFeatures.find((r) => t >= r.start && t < r.end + r.pauseAfter);
  return (
    <div className="card take">
      <div className="take-head">
        <audio ref={audio} src={take.audioUrl} controls onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
        <span className="chips">
          <span className="chip">{s.voice}</span>
          <span className="chip">{s.rate} wpm</span>
          <span className="chip">pitch {s.pitch}</span>
          <span className="chip">{s.pauses} pauses</span>
          <span className="chip">{s.tone}</span>
          <span className="chip muted">{take.duration.toFixed(1)} s</span>
        </span>
      </div>
      <div className="chart-wrap">
        <div className="chart" dangerouslySetInnerHTML={{ __html: take.chartSvg }} />
        <div className="playhead" style={{ left: 44 + t * 90 }} />
      </div>
      <p className="muted small">
        Blue: pitch (Hz) · green: loudness (dB) · yellow: pauses ≥ 0.25 s · words placed by estimated alignment. {current && <>Now: <strong>{current.word}</strong></>}
      </p>
      {!compact && (
        <details>
          <summary>Word table ({take.wordFeatures.length} words) — click a row to play from there</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>word</th>
                  <th>start s</th>
                  <th>dur s</th>
                  <th>pitch Hz</th>
                  <th>loudness dB</th>
                  <th>pause after s</th>
                </tr>
              </thead>
              <tbody>
                {take.wordFeatures.map((r) => (
                  <tr key={r.index} onClick={() => seek(r.start)} className={current?.index === r.index ? "now" : ""}>
                    <td>{r.index}</td>
                    <td>{r.word}</td>
                    <td>{r.start.toFixed(2)}</td>
                    <td>{r.duration.toFixed(2)}</td>
                    <td>{r.pitchHz ?? "–"}</td>
                    <td>{r.loudnessDb.toFixed(1)}</td>
                    <td className={r.pauseAfter >= 0.25 ? "hl" : ""}>{r.pauseAfter.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
