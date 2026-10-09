/**
 * tool_2 — deterministic parts of the game framework:
 * P3.5 compose (events_3 -> vignette_1), P4.1 init runtime_state, P4.4 select npc_activity,
 * P4.5 apply activities, P6.1 evaluate deviation.
 */
import { startPositions } from './tool1';
import type {
  Activity, Character, Deviation, Environment, KeyEvent, NpcPlan, PlannedActivity, PlayerAction,
  Project, RuntimeState, Vignette,
} from './types';

export function sortedEvents(events: KeyEvent[]): KeyEvent[] {
  return [...events].sort((a, b) => a.order - b.order);
}

/** P3.5 [tool_2 compose]: validates the authored elements and builds the playable vignette. */
export function composeVignette(p: Project, id: string, title: string): { vignette?: Vignette; errors: string[] } {
  const errors: string[] = [];
  const env = p.environment;
  if (!env) errors.push('There is no environment yet (Process 1).');
  const players = p.characters.filter((c) => c.isPlayer);
  if (players.length !== 1) errors.push('Exactly one character must be marked as the player.');
  if (p.characters.filter((c) => !c.isPlayer).length === 0) errors.push('At least one non-player character is needed.');
  if (p.events.length === 0) errors.push('There are no key events (Process 3).');
  const actIds = new Set(p.activities.map((a) => a.id));
  const charIds = new Set(p.characters.map((c) => c.id));
  const objIds = new Set((env?.objects ?? []).filter((o) => o.pos).map((o) => o.id));
  for (const e of p.events) {
    if (e.activityIds.length === 0) errors.push(`Event "${e.title}" has no activities.`);
    for (const aid of e.activityIds) if (!actIds.has(aid)) errors.push(`Event "${e.title}" references a missing activity.`);
  }
  for (const a of p.activities) {
    if (!charIds.has(a.characterId)) errors.push(`Activity "${a.action}" has an unknown character.`);
    if (a.objectId && !objIds.has(a.objectId)) errors.push(`Activity "${a.action}" uses an object that is not placed in the environment.`);
  }
  if (errors.length || !env) return { errors };
  const used = new Set(p.events.flatMap((e) => e.activityIds));
  const events = sortedEvents(p.events).map((e, i) => ({ ...e, order: i + 1 }));
  return {
    errors,
    vignette: {
      id, title,
      story: p.story,
      environment: { ...env, objects: env.objects.filter((o) => o.pos) },
      characters: p.characters,
      activities: p.activities.filter((a) => used.has(a.id)),
      events,
      startPositions: startPositions(env, p.characters.map((c) => c.id)),
      createdAt: new Date().toISOString(),
    },
  };
}

export const playerOf = (v: Vignette): Character => v.characters.find((c) => c.isPlayer)!;
export const npcsOf = (v: Vignette): Character[] => v.characters.filter((c) => !c.isPlayer);

/** P4.1 [tool_2 execute] — initial runtime_state. */
export function initRuntime(v: Vignette): RuntimeState {
  return {
    positions: { ...v.startPositions },
    eventIndex: 0,
    doneActivityIds: [],
    doing: {},
    log: [],
    round: 0,
    finished: v.events.length === 0,
  };
}

export function currentEvent(v: Vignette, s: RuntimeState): KeyEvent | undefined {
  return v.events[s.eventIndex];
}

export function pendingActivities(v: Vignette, s: RuntimeState, characterId?: string): Activity[] {
  const e = currentEvent(v, s);
  if (!e) return [];
  return e.activityIds
    .filter((id) => !s.doneActivityIds.includes(id))
    .map((id) => v.activities.find((a) => a.id === id)!)
    .filter((a) => a && (!characterId || a.characterId === characterId));
}

/** Does the action perform one of the player's pending key-event activities? */
export function matchPlayerActivity(v: Vignette, s: RuntimeState, a: PlayerAction): Activity | undefined {
  const mine = pendingActivities(v, s, playerOf(v).id);
  if (a.kind !== 'interact') return undefined;
  if (a.objectId === '__free__') return mine.find((x) => !x.objectId && x.id === a.verb);
  return mine.find((x) => x.objectId === a.objectId);
}

/** P6.1 [tool_2 evaluate] — deviation_1: did the player skip the next key-event activity? */
export function evaluateDeviation(v: Vignette, s: RuntimeState, a: PlayerAction): Deviation {
  const mine = pendingActivities(v, s, playerOf(v).id);
  if (mine.length === 0) return 'follows';
  return matchPlayerActivity(v, s, a) ? 'follows' : 'diverges';
}

/**
 * Validation of npc_plans_1 where they are produced: follow must perform the NPC's pending
 * key-event activity when it has one, and diverge must never complete a key-event activity
 * (so authored events are preserved). Unknown objects are dropped.
 */
export function validatePlans(v: Vignette, s: RuntimeState, raw: NpcPlan[]): NpcPlan[] {
  const objIds = new Set(v.environment.objects.map((o) => o.id));
  const fix = (cid: string, p: Partial<PlannedActivity> | undefined): PlannedActivity => ({
    characterId: cid,
    action: (p?.action || 'looks around').slice(0, 120),
    objectId: p?.objectId && objIds.has(p.objectId) ? p.objectId : null,
    activityId: null,
    say: (p?.say || '').slice(0, 160),
  });
  return npcsOf(v).map((c) => {
    const r = raw.find((x) => x.characterId === c.id);
    const follow = fix(c.id, r?.follow);
    const diverge = fix(c.id, r?.diverge);
    const scripted = pendingActivities(v, s, c.id)[0];
    if (scripted) {
      follow.action = scripted.action;
      follow.objectId = scripted.objectId;
      follow.activityId = scripted.id;
    }
    return { characterId: c.id, follow, diverge };
  });
}

/** P4.4 [tool_2 select] — npc_activity_1 from npc_plans_1 given the deviation. */
export function selectNpcActivities(plans: NpcPlan[], d: Deviation): PlannedActivity[] {
  return plans.map((p) => (d === 'follows' ? p.follow : p.diverge));
}

/** P4.5 [tool_2 execute] — state update after the player action and NPC activities are performed. */
export function applyRound(v: Vignette, s: RuntimeState, action: PlayerAction, npcActs: PlannedActivity[]): RuntimeState {
  const next: RuntimeState = { ...s, doneActivityIds: [...s.doneActivityIds], doing: { ...s.doing }, log: [...s.log], round: s.round + 1 };
  const player = playerOf(v);
  const m = matchPlayerActivity(v, s, action);
  if (m) { next.doneActivityIds.push(m.id); next.doing[player.id] = m.action; next.log.push(`${player.name}: ${m.action}`); }
  else if (action.kind === 'interact') {
    const o = v.environment.objects.find((x) => x.id === action.objectId);
    next.doing[player.id] = `${action.verb} ${o?.name ?? ''}`.trim();
    next.log.push(`${player.name}: ${next.doing[player.id]}`);
  }
  const pend = new Set(pendingActivities(v, s).map((a) => a.id));
  for (const a of npcActs) {
    const c = v.characters.find((x) => x.id === a.characterId);
    next.doing[a.characterId] = a.action;
    next.log.push(`${c?.name}: ${a.action}`);
    if (a.activityId && pend.has(a.activityId)) next.doneActivityIds.push(a.activityId);
  }
  if (pendingActivities(v, next).length === 0) {
    next.eventIndex = s.eventIndex + 1;
    if (next.eventIndex >= v.events.length) next.finished = true;
    else next.log.push(`— Next: ${v.events[next.eventIndex].title}`);
  }
  return next;
}

export function describeEnvironment(env: Environment): string {
  return env.rooms.map((r) => {
    const objs = env.objects.filter((o) => o.roomId === r.id && o.pos).map((o) => `${o.name} [${o.id}]${o.affordances.length ? ` (can: ${o.affordances.join(', ')})` : ''}`);
    return `Room ${r.id} "${r.label}": ${objs.join('; ') || 'empty'}`;
  }).join('\n');
}
