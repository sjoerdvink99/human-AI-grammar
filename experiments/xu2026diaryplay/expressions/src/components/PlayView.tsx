// Processes 4, 5, 6: play the vignette.
// P4: runtime + scene → NPC plans (model) → player action → NPC activity (select) → execute → loop … → end screen
// P5: player message → NPC reply (model) → scene
// P6: player action → deviation (evaluate) → inner voice (model) → scene
import { useCallback, useEffect, useRef, useState } from "react";
import type { Deviation, NpcPlan, PlayerAction, RuntimeState, Vignette } from "../shared/types";
import {
  applyInnerVoice,
  applyNpcReply,
  availableActivities,
  charName,
  evaluateDeviation,
  initRuntime,
  isFinished,
  nearbyNpcs,
  objectById,
  recordDeviation,
  selectNpcActivity,
  shouldVoice,
  step,
} from "../shared/engine";
import { api } from "../api";
import SceneCanvas from "./SceneCanvas";
import EndScreen from "./EndScreen";

export default function PlayView({ vignette: v }: { vignette: Vignette }) {
  const [runtime, setRuntimeState] = useState<RuntimeState>(() => initRuntime(v)); // P4.1 [tool_2 execute]
  const [plans, setPlansState] = useState<NpcPlan[]>([]);
  const [planning, setPlanning] = useState(false);
  const [deviation, setDeviation] = useState<Deviation>("on_track");
  const [voice, setVoice] = useState<string | null>(null);
  const [voicePending, setVoicePending] = useState(false);
  const [talkTo, setTalkTo] = useState<string>("");
  const [message, setMessage] = useState("");
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rtRef = useRef(runtime);
  const plansRef = useRef(plans);
  const gen = useRef(0); // bumps on restart so late model results are dropped
  const lastPlan = useRef<{ eventIndex: number; tick: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const setRuntime = useCallback((s: RuntimeState) => {
    rtRef.current = s;
    setRuntimeState(s);
  }, []);
  const setPlans = useCallback((p: NpcPlan[]) => {
    plansRef.current = p;
    setPlansState(p);
  }, []);

  const restart = () => {
    gen.current++;
    lastPlan.current = null;
    setRuntime(initRuntime(v));
    setPlans([]);
    setPlanning(false);
    setVoice(null);
    setDeviation("on_track");
  };
  useEffect(restart, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  // P4.2 [model generate]~ — re-plan when the event changes or NPCs have run out of steps.
  useEffect(() => {
    const s = runtime;
    if (isFinished(s) || planning) return;
    const lp = lastPlan.current;
    const current = plans.filter((p) => p.eventIndex === s.eventIndex);
    const exhausted = current.length > 0 && current.every((p) => p.steps.length === 0);
    const stale = !lp || lp.eventIndex !== s.eventIndex || (exhausted && s.tick - lp.tick >= 3);
    if (!stale) return;
    const g = gen.current;
    lastPlan.current = { eventIndex: s.eventIndex, tick: s.tick };
    setPlanning(true);
    api<{ plans: NpcPlan[] }>("plan-npcs", { vignette: v, runtimeState: s })
      .then((r) => {
        if (g !== gen.current) return;
        if (r.plans.every((p) => p.eventIndex === rtRef.current.eventIndex)) setPlans(r.plans);
      })
      .catch((e) => g === gen.current && setError(`NPC planning failed: ${e.message}`))
      .finally(() => g === gen.current && setPlanning(false));
  }, [runtime, plans, planning, v, setPlans]);

  // P4.3 [human specify] player_action → P4.4 select → P4.5 execute (loop) ; P6.1 evaluate → P6.2 → P6.3
  const act = useCallback(
    (action: PlayerAction) => {
      const before = rtRef.current;
      if (isFinished(before)) return;
      const selected = selectNpcActivity(v, before, plansRef.current); // P4.4 [tool_2 select]
      const r = step(v, before, plansRef.current, action, selected); // P4.5 [tool_2 execute]
      const dev = evaluateDeviation(v, before, r.state, action); // P6.1 [tool_2 evaluate]
      let next = recordDeviation(r.state, dev);
      setDeviation(dev);
      const voiceNow = shouldVoice(next, dev);
      if (voiceNow) next = { ...next, lastInnerVoiceTick: next.tick };
      setPlans(r.plans);
      setRuntime(next);
      if (voiceNow) {
        const g = gen.current;
        setVoicePending(true);
        api<{ text: string }>("inner-voice", { vignette: v, runtimeState: next, deviation: dev }) // P6.2 [model generate]~
          .then((res) => {
            if (g !== gen.current) return;
            setRuntime(applyInnerVoice(rtRef.current, res.text)); // P6.3 [tool_2 execute]
            setVoice(res.text);
            setTimeout(() => setVoice((cur) => (cur === res.text ? null : cur)), 8000);
          })
          .catch(() => {})
          .finally(() => setVoicePending(false));
      }
    },
    [v, setPlans, setRuntime],
  );

  // P5.1 [human specify] → P5.2 [model generate]~ → P5.3 [tool_2 execute]
  const nearby = nearbyNpcs(v, runtime);
  const target = nearby.find((c) => c.id === talkTo) ?? nearby[0];
  const talk = async () => {
    if (!target || !message.trim()) return;
    const g = gen.current;
    const said = message.trim();
    setTalking(true);
    setMessage("");
    try {
      const r = await api<{ reply: string }>("npc-reply", { vignette: v, runtimeState: rtRef.current, npcId: target.id, playerMessage: said });
      if (g === gen.current) setRuntime(applyNpcReply(v, rtRef.current, target.id, said, r.reply));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTalking(false);
    }
  };

  const activities = availableActivities(v, runtime);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
      };
      if (dirs[e.key]) {
        e.preventDefault();
        act({ type: "move", dx: dirs[e.key][0], dy: dirs[e.key][1] });
      } else if (e.key === " " || e.key === ".") {
        e.preventDefault();
        act({ type: "wait" });
      } else if (/^[1-9]$/.test(e.key)) {
        const a = availableActivities(v, rtRef.current)[Number(e.key) - 1];
        if (a) act({ type: "interact", activityId: a.id });
      } else if (e.key === "t") {
        e.preventDefault();
        document.getElementById("talk-input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, v]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [runtime.log.length]);

  // P4.6 [tool_2 execute] → end_screen
  if (isFinished(runtime)) return <EndScreen vignette={v} runtime={runtime} onRestart={restart} />;

  const ev = v.events[runtime.eventIndex];
  const involved = ev?.characterIds.includes(v.playerId);
  const tokens = v.characters
    .filter((c) => runtime.positions[c.id])
    .map((c) => ({ ...c, ...runtime.positions[c.id], isPlayer: c.id === v.playerId, bubble: runtime.bubbles[c.id]?.text }));

  return (
    <div className="split play">
      <section className="panel stage">
        <div className="scene-wrap">
          {/* (scene: artifact visual) */}
          <SceneCanvas environment={v.environment} objects={v.objects} tokens={tokens} tile={32} />
          {voice && <div className="inner-voice">💭 {voice}</div>}
        </div>
        <p className="muted keys">Move: arrows / WASD · Wait: space · Interact: 1–9 · Talk: T</p>
      </section>
      <section className="panel steps">
        <div className="step">
          <div className="row spread">
            <h3>{v.title}</h3>
            <button onClick={restart}>Restart</button>
          </div>
          <div className="progress">
            <div style={{ width: `${(runtime.eventIndex / v.events.length) * 100}%` }} />
          </div>
          {ev && (
            <div className={`event-card ${involved ? "you" : ""}`}>
              <span className="small">
                Event {runtime.eventIndex + 1}/{v.events.length} {involved ? "· you take part" : ""}
              </span>
              <p>{ev.description}</p>
            </div>
          )}
          <div className="row small">
            <span className={`badge ${deviation}`}>{deviation.replace("_", " ")}</span>
            <span className="muted">Tick {runtime.tick}</span>
            {planning && <span className="muted"><span className="spinner" /> NPCs planning…</span>}
            {voicePending && <span className="muted"><span className="spinner" /> inner voice…</span>}
          </div>
          {error && (
            <p className="status error">
              {error} <button onClick={() => setError(null)}>✕</button>
            </p>
          )}
        </div>

        <div className="step">
          <h4>Do</h4>
          <div className="row wrap">
            {activities.length === 0 && <span className="muted">Walk next to an object to interact with it.</span>}
            {activities.map((a, i) => (
              <button key={a.id} onClick={() => act({ type: "interact", activityId: a.id })}>
                <kbd>{i + 1}</kbd> {a.verb} {objectById(v, a.objectId)?.emoji} {objectById(v, a.objectId)?.name}
              </button>
            ))}
            <button onClick={() => act({ type: "wait" })}>⏳ Wait</button>
          </div>
        </div>

        <div className="step">
          <h4>Talk</h4>
          {nearby.length === 0 ? (
            <span className="muted">Nobody is close enough to talk to.</span>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                talk();
              }}
            >
              <select value={target?.id} onChange={(e) => setTalkTo(e.target.value)}>
                {nearby.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input id="talk-input" className="grow" value={message} placeholder="Say something…" onChange={(e) => setMessage(e.target.value)} />
              <button className="primary" disabled={talking || !message.trim()}>
                {talking ? "…" : "Say"}
              </button>
            </form>
          )}
        </div>

        <div className="step">
          <h4>Log</h4>
          <div className="log" ref={logRef}>
            {runtime.log.map((l, i) => (
              <div key={i} className={`log-${l.kind}`}>
                <span className="tick">{l.tick}</span> {l.speaker && <b>{l.speaker}: </b>}
                {l.kind === "inner_voice" ? <i>💭 {l.text}</i> : l.text}
              </div>
            ))}
          </div>
        </div>

        <details className="step">
          <summary>NPC plans</summary>
          {plans.map((p) => (
            <div key={p.characterId} className="small">
              <b>{charName(v, p.characterId)}</b>:{" "}
              {p.steps.length
                ? p.steps
                    .map((s) =>
                      s.kind === "goto"
                        ? `go to ${objectById(v, s.objectId)?.name}`
                        : s.kind === "activity"
                          ? v.activities.find((a) => a.id === s.activityId)?.verb
                          : s.kind === "say"
                            ? `say “${s.text}”`
                            : "wait",
                    )
                    .join(" → ")
                : "idle"}
            </div>
          ))}
        </details>
      </section>
    </div>
  );
}
