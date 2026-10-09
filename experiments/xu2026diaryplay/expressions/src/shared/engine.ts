// tool_2: the vignette composer and game engine (deterministic).
import { placeCharacters, roomAt, isFloor } from "./environment";
import type {
  Character,
  Deviation,
  GameObject,
  NpcPlan,
  NpcStep,
  PlayerAction,
  Project,
  RuntimeState,
  Vignette,
} from "./types";

type Pos = { x: number; y: number };

// ---------------------------------------------------------------- P3.5 [tool_2 compose]

/** story + environment + objects + characters + events → vignette. Returns problems instead of throwing. */
export function composeVignette(p: Project, title: string): { vignette: Vignette | null; problems: string[] } {
  const problems: string[] = [];
  if (!p.environment) problems.push("Build the environment in the World tab first.");
  if (!p.characters.length) problems.push("Add at least one character.");
  const players = p.characters.filter((c) => c.isPlayer);
  if (players.length !== 1) problems.push("Mark exactly one character as the player.");
  if (!p.events.length) problems.push("Add at least one plot event.");
  if (problems.length || !p.environment) return { vignette: null, problems };

  const env = p.environment;
  const objects = p.objects.filter((o) => o.x != null && o.y != null && isFloor(env, o.x, o.y));
  const objectIds = new Set(objects.map((o) => o.id));
  const activities = p.activities.filter((a) => objectIds.has(a.objectId));
  const activityIds = new Set(activities.map((a) => a.id));
  const characterIds = new Set(p.characters.map((c) => c.id));
  const roomIds = new Set(env.rooms.map((r) => r.id));
  const events = p.events.map((e) => ({
    ...e,
    activityId: e.activityId && activityIds.has(e.activityId) ? e.activityId : null,
    roomId: e.roomId && roomIds.has(e.roomId) ? e.roomId : null,
    characterIds: e.characterIds.filter((id) => characterIds.has(id)),
  }));
  const characters = placeCharacters(env, objects, p.characters);
  if (characters.some((c) => c.x == null)) problems.push("Some characters could not be placed: free some floor space.");
  return {
    vignette: {
      title: title || "Untitled vignette",
      story: p.story,
      environment: env,
      objects,
      characters,
      activities,
      events,
      playerId: players[0].id,
    },
    problems,
  };
}

// ---------------------------------------------------------------- P4.1 [tool_2 execute]

export function initRuntime(v: Vignette): RuntimeState {
  const positions: RuntimeState["positions"] = {};
  for (const c of v.characters) if (c.x != null && c.y != null) positions[c.id] = { x: c.x, y: c.y };
  const first = v.events[0];
  return {
    tick: 0,
    positions,
    eventIndex: 0,
    completedEvents: [],
    doneActivities: [],
    bubbles: {},
    log: [
      { tick: 0, kind: "system", text: `"${v.title}" begins. You are ${charName(v, v.playerId)}.` },
      ...(first ? [{ tick: 0, kind: "event" as const, text: `Now: ${first.description}` }] : []),
    ],
    finished: v.events.length === 0,
    eventStartTick: 0,
    offTrackStreak: 0,
    lastInnerVoiceTick: -100,
  };
}

// ---------------------------------------------------------------- helpers

export function charName(v: Vignette, id: string) {
  return v.characters.find((c) => c.id === id)?.name ?? id;
}

export function objectById(v: Vignette, id: string | null | undefined): GameObject | undefined {
  return v.objects.find((o) => o.id === id);
}

export function activityObject(v: Vignette, activityId: string | null | undefined) {
  const a = v.activities.find((x) => x.id === activityId);
  return a ? objectById(v, a.objectId) : undefined;
}

export function isAdjacent(a: Pos, b: Pos) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
}

function blocked(v: Vignette, s: RuntimeState, x: number, y: number, self: string) {
  if (!isFloor(v.environment, x, y)) return true;
  if (v.objects.some((o) => o.x === x && o.y === y)) return true;
  return Object.entries(s.positions).some(([id, p]) => id !== self && p.x === x && p.y === y);
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** BFS from `from` until `isGoal`; returns path length and first step. Other characters are ignored except on the first step. */
function bfs(v: Vignette, s: RuntimeState, self: string, from: Pos, isGoal: (p: Pos) => boolean) {
  if (isGoal(from)) return { dist: 0, first: null as Pos | null };
  const seen = new Set([`${from.x},${from.y}`]);
  const queue: { p: Pos; first: Pos; d: number }[] = [];
  for (const [dx, dy] of DIRS) {
    const p = { x: from.x + dx, y: from.y + dy };
    if (blocked(v, s, p.x, p.y, self)) continue;
    seen.add(`${p.x},${p.y}`);
    queue.push({ p, first: p, d: 1 });
  }
  while (queue.length) {
    const cur = queue.shift()!;
    if (isGoal(cur.p)) return { dist: cur.d, first: cur.first };
    for (const [dx, dy] of DIRS) {
      const p = { x: cur.p.x + dx, y: cur.p.y + dy };
      const k = `${p.x},${p.y}`;
      if (seen.has(k) || !isFloor(v.environment, p.x, p.y) || v.objects.some((o) => o.x === p.x && o.y === p.y)) continue;
      seen.add(k);
      queue.push({ p, first: cur.first, d: cur.d + 1 });
    }
  }
  return { dist: Infinity, first: null };
}

function goalFor(v: Vignette, targetObject?: GameObject, roomId?: string | null) {
  if (targetObject) return (p: Pos) => isAdjacent(p, { x: targetObject.x!, y: targetObject.y! });
  if (roomId) return (p: Pos) => roomAt(v.environment, p.x, p.y)?.id === roomId;
  return null;
}

// ---------------------------------------------------------------- P4.4 [tool_2 select]

/** npc_plans + runtime_state → npc_activity: the step each NPC takes this tick. */
export function selectNpcActivity(v: Vignette, s: RuntimeState, plans: NpcPlan[]): Record<string, NpcStep> {
  const out: Record<string, NpcStep> = {};
  const ev = v.events[s.eventIndex];
  for (const c of v.characters) {
    if (c.id === v.playerId || !s.positions[c.id]) continue;
    const plan = plans.find((p) => p.characterId === c.id && p.eventIndex === s.eventIndex);
    if (plan && plan.steps.length) {
      out[c.id] = plan.steps[0];
      continue;
    }
    // Fallback when no plan is available: NPCs carry the current event if the player is not part of it.
    const done = ev?.activityId && s.doneActivities.some((d) => d.activityId === ev.activityId && d.tick >= s.eventStartTick);
    if (ev && ev.characterIds.includes(c.id) && !ev.characterIds.includes(v.playerId) && ev.activityId && !done)
      out[c.id] = { kind: "activity", activityId: ev.activityId };
    else out[c.id] = { kind: "wait" };
  }
  return out;
}

// ---------------------------------------------------------------- P4.5 [tool_2 execute]

function moveToward(v: Vignette, s: RuntimeState, id: string, obj: GameObject) {
  const from = s.positions[id];
  const r = bfs(v, s, id, from, (p) => isAdjacent(p, { x: obj.x!, y: obj.y! }));
  if (r.first && !blocked(v, s, r.first.x, r.first.y, id)) s.positions[id] = r.first;
  return r.dist;
}

function doActivity(v: Vignette, s: RuntimeState, id: string, activityId: string) {
  const a = v.activities.find((x) => x.id === activityId);
  const obj = activityObject(v, activityId);
  if (!a || !obj) return false;
  if (!isAdjacent(s.positions[id], { x: obj.x!, y: obj.y! })) return false;
  s.doneActivities.push({ characterId: id, activityId, tick: s.tick });
  s.bubbles[id] = { text: `*${a.verb} ${obj.name}*`, until: s.tick + 2 };
  s.log.push({ tick: s.tick, kind: "action", speaker: charName(v, id), text: `${a.verb} ${obj.name}` });
  return true;
}

/** Apply the player action and the selected NPC activity, then advance the plot. Returns new state + consumed plans. */
export function step(
  v: Vignette,
  prev: RuntimeState,
  plans: NpcPlan[],
  action: PlayerAction,
  selected: Record<string, NpcStep>,
): { state: RuntimeState; plans: NpcPlan[] } {
  const s: RuntimeState = structuredClone(prev);
  const nextPlans: NpcPlan[] = structuredClone(plans);
  s.tick += 1;
  for (const [id, b] of Object.entries(s.bubbles)) if (b.until < s.tick) delete s.bubbles[id];

  // Player
  const me = v.playerId;
  if (action.type === "move") {
    const p = s.positions[me];
    const nx = p.x + action.dx;
    const ny = p.y + action.dy;
    if (!blocked(v, s, nx, ny, me)) s.positions[me] = { x: nx, y: ny };
  } else if (action.type === "interact") {
    doActivity(v, s, me, action.activityId);
  }

  // NPCs
  for (const [id, st] of Object.entries(selected)) {
    let consumed = false;
    if (st.kind === "wait") consumed = true;
    else if (st.kind === "say") {
      s.bubbles[id] = { text: st.text, until: s.tick + 2 };
      s.log.push({ tick: s.tick, kind: "dialogue", speaker: charName(v, id), text: st.text });
      consumed = true;
    } else if (st.kind === "goto") {
      const obj = objectById(v, st.objectId);
      consumed = !obj || moveToward(v, s, id, obj) <= 1;
    } else if (st.kind === "activity") {
      const obj = activityObject(v, st.activityId);
      if (!obj) consumed = true;
      else if (isAdjacent(s.positions[id], { x: obj.x!, y: obj.y! })) consumed = doActivity(v, s, id, st.activityId);
      else if (moveToward(v, s, id, obj) === Infinity) consumed = true; // unreachable: give up
    }
    if (consumed) {
      const plan = nextPlans.find((p) => p.characterId === id && p.eventIndex === s.eventIndex);
      if (plan && plan.steps.length) plan.steps.shift();
    }
  }

  advanceEvents(v, s);
  return { state: s, plans: nextPlans };
}

export function eventComplete(v: Vignette, s: RuntimeState): boolean {
  const ev = v.events[s.eventIndex];
  if (!ev) return false;
  if (ev.activityId) {
    return s.doneActivities.some(
      (d) =>
        d.activityId === ev.activityId &&
        d.tick >= s.eventStartTick &&
        (ev.characterIds.length === 0 || ev.characterIds.includes(d.characterId)),
    );
  }
  if (ev.roomId) {
    const who = ev.characterIds.length ? ev.characterIds : [v.playerId];
    return who.every((id) => {
      const p = s.positions[id];
      return p && roomAt(v.environment, p.x, p.y)?.id === ev.roomId;
    });
  }
  return s.tick - s.eventStartTick >= 2;
}

function advanceEvents(v: Vignette, s: RuntimeState) {
  while (!s.finished && eventComplete(v, s)) {
    const ev = v.events[s.eventIndex];
    s.completedEvents.push(ev.id);
    s.log.push({ tick: s.tick, kind: "event", text: `✓ ${ev.description}` });
    s.eventIndex += 1;
    s.eventStartTick = s.tick;
    s.offTrackStreak = 0;
    const next = v.events[s.eventIndex];
    if (next) s.log.push({ tick: s.tick, kind: "event", text: `Now: ${next.description}` });
    else s.finished = true;
  }
}

// ---------------------------------------------------------------- P4.6 [tool_2 execute] → end_screen

export function isFinished(s: RuntimeState) {
  return s.finished;
}

// ---------------------------------------------------------------- P5.3 [tool_2 execute]

export function applyNpcReply(v: Vignette, prev: RuntimeState, npcId: string, playerMessage: string, reply: string): RuntimeState {
  const s: RuntimeState = structuredClone(prev);
  s.bubbles[v.playerId] = { text: playerMessage, until: s.tick + 2 };
  s.bubbles[npcId] = { text: reply, until: s.tick + 3 };
  s.log.push({ tick: s.tick, kind: "dialogue", speaker: charName(v, v.playerId), text: playerMessage });
  s.log.push({ tick: s.tick, kind: "dialogue", speaker: charName(v, npcId), text: reply });
  return s;
}

// ---------------------------------------------------------------- P6.1 [tool_2 evaluate]

/** player_action vs. the current plot event → deviation. `before` is the state the action was taken in. */
export function evaluateDeviation(v: Vignette, before: RuntimeState, after: RuntimeState, action: PlayerAction): Deviation {
  const ev = v.events[before.eventIndex];
  if (!ev || before.finished) return "on_track";
  if (after.eventIndex > before.eventIndex) return "on_track";
  const involved = ev.characterIds.includes(v.playerId);
  let d: Deviation = "on_track";
  if (action.type === "interact") {
    const futureIdx = v.events.findIndex((e, i) => i > before.eventIndex && e.activityId === action.activityId);
    if (action.activityId === ev.activityId) d = "on_track";
    else if (futureIdx >= 0) d = "major";
    else d = involved ? "minor" : "on_track";
  } else if (involved) {
    const goal = goalFor(v, activityObject(v, ev.activityId), ev.roomId);
    if (!goal) d = "on_track";
    else if (action.type === "wait") d = "minor";
    else {
      const me = v.playerId;
      const db = bfs(v, before, me, before.positions[me], goal).dist;
      const da = bfs(v, after, me, after.positions[me], goal).dist;
      d = da < db || da === 0 ? "on_track" : "minor";
    }
  }
  if (d === "minor" && before.offTrackStreak + 1 >= 4) d = "major";
  return d;
}

/** Update the streak bookkeeping after evaluation. */
export function recordDeviation(s: RuntimeState, d: Deviation): RuntimeState {
  return { ...s, offTrackStreak: d === "on_track" ? 0 : s.offTrackStreak + 1 };
}

/** Trigger rule for P6.2: always on major, on minor only every 4 ticks after two off-track steps. */
export function shouldVoice(s: RuntimeState, d: Deviation) {
  if (d === "major") return s.tick - s.lastInnerVoiceTick >= 2;
  if (d === "minor") return s.offTrackStreak >= 2 && s.tick - s.lastInnerVoiceTick >= 4;
  return false;
}

// ---------------------------------------------------------------- P6.3 [tool_2 execute]

export function applyInnerVoice(prev: RuntimeState, text: string): RuntimeState {
  const s: RuntimeState = structuredClone(prev);
  s.lastInnerVoiceTick = s.tick;
  s.log.push({ tick: s.tick, kind: "inner_voice", text });
  return s;
}

/** Characters near the player who can be talked to (P5). */
export function nearbyNpcs(v: Vignette, s: RuntimeState): Character[] {
  const me = s.positions[v.playerId];
  return v.characters.filter((c) => {
    const p = s.positions[c.id];
    return c.id !== v.playerId && p && Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y)) <= 2;
  });
}

/** Activities the player can perform from where they stand. */
export function availableActivities(v: Vignette, s: RuntimeState) {
  const me = s.positions[v.playerId];
  return v.activities.filter((a) => {
    const o = objectById(v, a.objectId);
    return o && isAdjacent(me, { x: o.x!, y: o.y! });
  });
}
