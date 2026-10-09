/**
 * Processes 4–6 at play time.
 * P4: tool_2 execute (scene) -> model plans npc_plans~ -> player_action -> tool_2 select -> tool_2 execute -> loop / end_screen
 * P5: player_message -> model npc_reply~ -> tool_2 execute (speech bubble)
 * P6: tool_2 evaluate deviation -> model inner_voice~ -> tool_2 execute (non-blocking overlay)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Engine, TILE } from '../game/engine';
import { approachTiles } from '../../shared/tool1';
import {
  applyRound, currentEvent, evaluateDeviation, initRuntime, npcsOf, pendingActivities, playerOf,
  selectNpcActivities, validatePlans,
} from '../../shared/runtime';
import type { Deviation, NpcPlan, PlannedActivity, PlayerAction, RuntimeState, Vignette } from '../../shared/types';

const IDLE_MS = 30000;
type Menu = { title: string; options: { label: string; action: PlayerAction }[] };
interface ChatMsg { from: string; text: string }

export default function Play({ id }: { id: string }) {
  const [v, setV] = useState<Vignette | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.getVignette(id).then(setV).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="app"><p className="error">{err}</p><a href="#/">Back</a></div>;
  if (!v) return <div className="app"><p className="busy">Loading vignette…</p></div>;
  return <Game key={v.id + v.createdAt} v={v} />;
}

function Game({ v }: { v: Vignette }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const stateRef = useRef<RuntimeState>(initRuntime(v));
  const [state, setState] = useState<RuntimeState>(stateRef.current);
  const plansRef = useRef<Promise<NpcPlan[]> | null>(null);
  const [plans, setPlans] = useState<NpcPlan[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [roundInfo, setRoundInfo] = useState<{ deviation: Deviation; acts: PlannedActivity[] } | null>(null);
  const roundBusy = useRef(false);
  const [busyText, setBusyText] = useState('');
  const lastAction = useRef(performance.now());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [chatWith, setChatWith] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, ChatMsg[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [voices, setVoices] = useState<string[]>([]);
  const [ended, setEnded] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [toast, setToast] = useState('');
  const player = playerOf(v);

  const snapshot = (): RuntimeState => ({ ...stateRef.current, positions: engine.current?.positions() ?? stateRef.current.positions });
  const commit = (s: RuntimeState) => { stateRef.current = s; setState(s); };
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2500); };

  // P4.2 [model generate]~ — plan two activities per NPC for the next step
  const planCycle = useCallback(() => {
    const s = snapshot();
    setPlanning(true); setPlans(null);
    const p = api.npcPlans({ vignette: v, runtimeState: s })
      .then((r) => r.plans)
      .catch((e) => { flash(`Planning failed (${e.message}); NPCs use scripted fallbacks.`); return validatePlans(v, s, []); })
      .then((pl) => { setPlans(pl); setPlanning(false); return pl; });
    plansRef.current = p;
    return p;
  }, [v]);

  // One round of the P4 loop, triggered by a player_action (P4.3)
  const handleAction = useCallback(async (action: PlayerAction) => {
    if (roundBusy.current) { flash('Wait a moment — the others are still busy.'); return; }
    if (stateRef.current.finished) return;
    roundBusy.current = true;
    lastAction.current = performance.now();
    setMenu(null);
    try {
      const s = snapshot();
      // P6.1 [tool_2 evaluate]
      const deviation = evaluateDeviation(v, s, action);
      if (deviation === 'diverges' && action.kind !== 'wait') {
        // P6.2 [model generate]~ -> P6.3 [tool_2 execute]; runs alongside, never blocks the round
        api.innerVoice({ vignette: v, runtimeState: s, playerAction: action })
          .then((r) => { engine.current?.innerVoice(r.innerVoice); setVoices((x) => [...x, r.innerVoice]); })
          .catch(() => {});
      }
      if (action.kind === 'interact' && action.objectId !== '__free__') {
        const o = v.environment.objects.find((x) => x.id === action.objectId);
        engine.current?.setLabel(player.id, `${action.verb} ${o?.name ?? ''}`);
      } else if (action.kind === 'interact') {
        engine.current?.setLabel(player.id, v.activities.find((a) => a.id === action.verb)?.action ?? '');
      }
      setBusyText('The others are deciding what to do…');
      const pl = await (plansRef.current ?? planCycle());
      // P4.4 [tool_2 select]
      const acts = selectNpcActivities(pl, deviation);
      setRoundInfo({ deviation, acts });
      setBusyText('');
      // P4.5 [tool_2 execute]
      await Promise.race([Promise.all(acts.map((a) => engine.current!.perform(a))), new Promise((r) => setTimeout(r, 12000))]);
      const next = applyRound(v, s, action, acts);
      next.positions = engine.current!.positions();
      commit(next);
      if (next.finished) { setTimeout(() => setEnded(true), 2500); return; } // P4.6
      planCycle(); // loop back to P4.2
      if (pendingActivities(v, next, player.id).length === 0) {
        // no player part in this event: the scene moves on by itself
        setTimeout(() => { roundBusy.current = false; handleAction({ kind: 'wait' }); }, 2500);
        return;
      }
    } finally {
      if (!stateRef.current.finished) setTimeout(() => { roundBusy.current = false; }, 0);
    }
  }, [v, planCycle]);

  // P4.1 [tool_2 execute] — render the scene and start the first planning cycle
  useEffect(() => {
    engine.current = new Engine(canvas.current!, v);
    (window as any).__positions = () => engine.current?.positions(); // for scripted walkthroughs
    planCycle().then(() => {
      if (pendingActivities(v, stateRef.current, player.id).length === 0) handleAction({ kind: 'wait' });
    });
    return () => engine.current?.destroy();
  }, [v]);

  // idle detection: doing nothing also counts as not following the next event
  useEffect(() => {
    const t = setInterval(() => {
      if (!roundBusy.current && !ended && !chatWith && pendingActivities(v, stateRef.current, player.id).length && performance.now() - lastAction.current > IDLE_MS) {
        handleAction({ kind: 'idle' });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [ended, chatWith]);

  const nearbyObjects = () => {
    const pt = engine.current!.tileOf(player.id)!;
    return v.environment.objects.filter((o) => approachTiles(v.environment, o).some((t) => t.x === pt.x && t.y === pt.y));
  };
  const nearestNpc = () => {
    const pt = engine.current!.tileOf(player.id)!;
    let best: { id: string; d: number } | null = null;
    for (const c of npcsOf(v)) { const q = engine.current!.tileOf(c.id)!; const d = Math.abs(q.x - pt.x) + Math.abs(q.y - pt.y); if (!best || d < best.d) best = { id: c.id, d }; }
    return best && best.d <= 3 ? best.id : null;
  };
  const objectMenu = (objs = nearbyObjects()) => {
    if (!objs.length) { flash('Nothing to use here. Walk next to an object.'); return; }
    setMenu({ title: objs.length === 1 ? `${objs[0].emoji} ${objs[0].name}` : 'Nearby', options: objs.flatMap((o) => o.affordances.map((verb) => ({ label: `${objs.length > 1 ? `${o.emoji} ` : ''}${verb} ${objs.length > 1 ? o.name : ''}`, action: { kind: 'interact' as const, objectId: o.id, verb } }))) });
  };
  const doMenu = () => {
    const free = v.activities.filter((a) => a.characterId === player.id && !a.objectId);
    setMenu({ title: 'Do…', options: [...free.map((a) => ({ label: a.action, action: { kind: 'interact' as const, objectId: '__free__', verb: a.id } })), { label: 'Wait and watch', action: { kind: 'wait' } }] });
  };

  // P4.3 [human specify] — keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || ended) return;
      const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
      const d = dirs[e.key];
      if (d) { e.preventDefault(); setMenu(null); engine.current?.step(player.id, d[0], d[1]); return; }
      if (e.key === 'e' || e.key === ' ') { e.preventDefault(); objectMenu(); }
      if (e.key === 'q') doMenu();
      if (e.key === 't') { const n = nearestNpc(); if (n) setChatWith(n); else flash('Nobody close enough to talk to.'); }
      if (e.key === 'Escape') setMenu(null);
      if (/^[1-9]$/.test(e.key) && menu) { const o = menu.options[+e.key - 1]; if (o) handleAction(o.action); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [menu, ended, handleAction]);

  // P4.3 [human specify] — mouse
  const onCanvasClick = async (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * canvas.current!.width, py = ((e.clientY - r.top) / r.height) * canvas.current!.height;
    const eng = engine.current!;
    const actor = eng.actorAtPixel(px, py);
    if (actor && actor.id !== player.id) {
      const q = actor.tile;
      await eng.walkTo(player.id, [{ x: q.x + 1, y: q.y }, { x: q.x - 1, y: q.y }, { x: q.x, y: q.y + 1 }, { x: q.x, y: q.y - 1 }]);
      setChatWith(actor.id); return;
    }
    const obj = eng.objectAtPixel(px, py);
    if (obj) { setMenu(null); if (await eng.walkToObject(player.id, obj.id)) objectMenu([obj]); return; }
    setMenu(null);
    eng.walkTo(player.id, [{ x: Math.floor(px / TILE), y: Math.floor(py / TILE) }]);
  };

  // P5.1 [human specify] -> P5.2 [model generate]~ -> P5.3 [tool_2 execute]
  const sendChat = async () => {
    if (!chatWith || !chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput(''); setChatBusy(true);
    setChats((c) => ({ ...c, [chatWith]: [...(c[chatWith] ?? []), { from: player.name, text: msg }] }));
    engine.current?.say(player.id, msg, 4000);
    try {
      const r = await api.npcReply({ vignette: v, runtimeState: snapshot(), characterId: chatWith, message: msg });
      engine.current?.say(chatWith, r.reply);
      setChats((c) => ({ ...c, [chatWith]: [...(c[chatWith] ?? []), { from: v.characters.find((x) => x.id === chatWith)!.name, text: r.reply }] }));
    } catch (e: any) { flash(e.message); } finally { setChatBusy(false); }
  };

  const ev = currentEvent(v, state);
  const chatChar = v.characters.find((c) => c.id === chatWith);
  const name = (id: string) => v.characters.find((c) => c.id === id)?.name ?? id;
  const obj = (id: string | null) => v.environment.objects.find((o) => o.id === id);

  return (
    <div className="app play">
      <header className="topbar">
        <h1>{v.title}</h1>
        <div className="spacer" />
        <a href="#/" className="ghost btnlike">✎ Authoring</a>
      </header>
      <div className="playcols">
        <div className="stage">
          <canvas ref={canvas} onClick={onCanvasClick} />
          {menu && (
            <div className="menu">
              <b>{menu.title}</b>
              {menu.options.map((o, i) => <button key={i} onClick={() => handleAction(o.action)}><kbd>{i + 1}</kbd> {o.label}</button>)}
              <button className="ghost" onClick={() => setMenu(null)}>Cancel (Esc)</button>
            </div>
          )}
          {toast && <div className="toast">{toast}</div>}
          {ended && (
            <div className="endscreen">
              <h2>The End</h2>
              <p><i>{v.title}</i></p>
              <ol>{v.events.map((e) => <li key={e.id}>{e.title}</li>)}</ol>
              <details><summary>What happened</summary><ul className="small">{state.log.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
              <div className="row center">
                <button className="primary" onClick={() => location.reload()}>Play again</button>
                <a className="btnlike" href="#/">Back to authoring</a>
              </div>
            </div>
          )}
          <p className="hint">Move: arrows / WASD or click · Use object: E or click it · Do…: Q · Talk: T or click a person</p>
        </div>
        <aside className="side">
          <div className="card">
            <h3>Next</h3>
            {ev ? <p><b>{state.eventIndex + 1}/{v.events.length}</b> · {ev.title}</p> : <p>Finished</p>}
            <div className="progress"><div style={{ width: `${(state.eventIndex / v.events.length) * 100}%` }} /></div>
            <p className="small muted">You are <b>{player.name}</b>.</p>
            {busyText && <p className="busy small">⏳ {busyText}</p>}
            {planning && !busyText && <p className="small muted">The others are thinking ahead…</p>}
          </div>
          {chatChar && (
            <div className="card chat">
              <h3>Talking to {chatChar.name} <button className="ghost small" onClick={() => setChatWith(null)}>✕</button></h3>
              <div className="msgs">{(chats[chatChar.id] ?? []).map((m, i) => <div key={i} className={m.from === player.name ? 'me' : 'them'}><b>{m.from}:</b> {m.text}</div>)}</div>
              {chatBusy && <p className="busy small">{chatChar.name} is answering…</p>}
              <div className="row">
                <input className="grow" autoFocus value={chatInput} placeholder="Say something…" onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); if (e.key === 'Escape') setChatWith(null); }} />
                <button disabled={chatBusy || !chatInput.trim()} onClick={sendChat}>Send</button>
              </div>
            </div>
          )}
          {voices.length > 0 && (
            <div className="card">
              <h3>💭 Inner voice</h3>
              {voices.slice(-3).map((t, i) => <p key={i} className="small voice">{t}</p>)}
            </div>
          )}
          <div className="card">
            <h3>Story so far</h3>
            <ul className="log small">{state.log.slice(-10).map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
          <div className="card">
            <label className="inline small"><input type="checkbox" checked={showPlans} onChange={(e) => setShowPlans(e.target.checked)} /> Show NPC plans (Controlled Divergence)</label>
            {showPlans && (
              <div className="small">
                {roundInfo && <p>Last round: player <b>{roundInfo.deviation}</b> → {roundInfo.acts.map((a) => `${name(a.characterId)} ${a.action}`).join('; ')}</p>}
                {plans ? plans.map((p) => (
                  <div key={p.characterId} className="plan">
                    <b>{name(p.characterId)}</b>
                    <div>if you follow: {p.follow.action}{obj(p.follow.objectId) ? ` (${obj(p.follow.objectId)!.name})` : ''}{p.follow.activityId && ' ★'}</div>
                    <div>if you diverge: {p.diverge.action}{obj(p.diverge.objectId) ? ` (${obj(p.diverge.objectId)!.name})` : ''}</div>
                  </div>
                )) : <p className="muted">planning…</p>}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
