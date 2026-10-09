/**
 * One function per [model op] in the design. Each prompt is built only from the
 * representations in the state preceding that step; outputs are validated here.
 */
import { callModel } from './llm';
import { LAYOUTS, getLayout } from '../shared/layouts';
import { currentEvent, describeEnvironment, npcsOf, pendingActivities, playerOf, validatePlans } from '../shared/runtime';
import type {
  Activity, Character, Environment, GameObject, KeyEvent, NpcPlan, PlayerAction, RoomLabels, RuntimeState, Vignette,
} from '../shared/types';

const COLORS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9b5de5', '#f15bb5', '#00bbf9', '#8d6e63'];
const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;
const obj = (properties: Record<string, object>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';

function charList(cs: Character[]): string {
  return cs.map((c) => `- ${c.name} [${c.id}]${c.isPlayer ? ' (PLAYER)' : ''}: ${c.description}
  personality: ${c.personality}${c.traits.length ? `; traits: ${c.traits.join(', ')}` : ''}
  background: ${c.background}; goals: ${c.goals}; speaking style: ${c.speakingStyle}`).join('\n');
}

const AUTHOR_SYS = 'You help everyday storytellers turn a short story into a small playable 2D interactive vignette (a top-down scene with rooms, objects and characters). Answer only with the requested JSON.';

// ---------- Process 1 ----------

/** P1.1 [model extract]: story_1 + layouts_1 -> characters_1 */
export async function extractCharacters(story: string): Promise<Character[]> {
  const r = await callModel<{ characters: Omit<Character, 'id' | 'traits' | 'color'>[] }>({
    op: 'extract-characters', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nExtract the people who appear in this story (at most 6). Mark exactly one as the player: the narrator or protagonist through whose eyes the story is told. For every person fill in the persona fields from the story; when the story says nothing, write a short plausible guess consistent with it.`,
    schema: obj({ characters: { type: 'array', items: obj({ name: str, isPlayer: { type: 'boolean' }, description: str, personality: str, background: str, goals: str, speakingStyle: str }) } }),
  });
  let cs: Character[] = (r.characters || []).slice(0, 6).map((c, i) => ({
    ...c, id: `c-${slug(c.name)}-${i}`, traits: [], color: COLORS[i % COLORS.length],
  }));
  if (cs.length === 0) throw new Error('No characters found in the story.');
  const players = cs.filter((c) => c.isPlayer);
  if (players.length !== 1) cs = cs.map((c, i) => ({ ...c, isPlayer: i === 0 }));
  return cs;
}

/** P1.2 [model select]: story_1 + layouts_1 + characters_1 -> layout_1 */
export async function selectLayout(story: string, characters: Character[]): Promise<{ layoutId: string; reason: string }> {
  const r = await callModel<{ layoutId: string; reason: string }>({
    op: 'select-layout', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charList(characters)}\n\nAvailable room layouts:\n${LAYOUTS.map((l) => `- ${l.id}: ${l.name} — ${l.description} (${l.rooms.length} rooms: ${l.rooms.map((r) => `${r.id} ${r.w}x${r.h}`).join(', ')})`).join('\n')}\n\nChoose the one layout whose rooms best fit the places where this story happens.`,
    schema: obj({ layoutId: { type: 'string', enum: LAYOUTS.map((l) => l.id) }, reason: str }),
  });
  if (!getLayout(r.layoutId)) r.layoutId = LAYOUTS[0].id;
  return r;
}

/** P1.3 [model assign]: story_1 + layout_1 + characters_1 -> room_labels_1 */
export async function assignRoomLabels(story: string, layoutId: string, characters: Character[]): Promise<RoomLabels> {
  const layout = getLayout(layoutId)!;
  const r = await callModel<{ labels: { roomId: string; label: string }[] }>({
    op: 'assign-room-labels', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charList(characters)}\n\nLayout "${layout.name}" has rooms: ${layout.rooms.map((x) => `${x.id} (${x.w}x${x.h} tiles)`).join(', ')}.\nLabel every room with what it is in this story (e.g. "kitchen", "living room"). Use short lowercase labels, each room a different label. Bigger rooms should hold the places where most of the story happens.`,
    schema: obj({ labels: { type: 'array', items: obj({ roomId: { type: 'string', enum: layout.rooms.map((x) => x.id) }, label: str }) } }),
  });
  const out: RoomLabels = {};
  for (const room of layout.rooms) out[room.id] = r.labels.find((l) => l.roomId === room.id)?.label?.trim().slice(0, 30) || `room ${room.id}`;
  return out;
}

/** P1.5 [model generate]~: story_1 + layout_1 + characters_1 + room_labels_2 -> objects_1 */
export async function generateObjects(story: string, layoutId: string, characters: Character[], labels: RoomLabels): Promise<GameObject[]> {
  const layout = getLayout(layoutId)!;
  const r = await callModel<{ objects: { name: string; roomId: string; w: number; h: number; againstWall: boolean }[] }>({
    op: 'generate-objects', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charList(characters)}\n\nRooms:\n${layout.rooms.map((x) => `- ${x.id} "${labels[x.id]}" (${x.w}x${x.h} tiles)`).join('\n')}\n\nPropose the furniture and objects for each room: everything the story mentions or the characters use, plus a few typical items so the room feels real. 3–7 objects per room. Sizes are in tiles (1 tile ≈ 1 person): w and h between 1 and 3. Keep the total footprint well under a third of each room. againstWall is true for things like shelves, beds, counters, stoves.`,
    schema: obj({ objects: { type: 'array', items: obj({ name: str, roomId: { type: 'string', enum: layout.rooms.map((x) => x.id) }, w: { type: 'integer' }, h: { type: 'integer' }, againstWall: { type: 'boolean' } }) } }),
  });
  const seen = new Set<string>();
  return (r.objects || []).filter((o) => layout.rooms.some((x) => x.id === o.roomId)).slice(0, 40).map((o) => {
    let id = `o-${slug(o.name)}`;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    const clamp = (n: number) => Math.max(1, Math.min(3, Math.round(n || 1)));
    return { id, name: o.name.slice(0, 40), roomId: o.roomId, w: clamp(o.w), h: clamp(o.h), againstWall: !!o.againstWall, emoji: '', affordances: [], pos: null };
  });
}

/** P1.7 [model assign]: story_1 + environment_1 + characters_1 + objects_1 -> objects_2 (affordances, icon) */
export async function assignObjectAffordances(story: string, env: Environment, characters: Character[], objects: GameObject[]): Promise<GameObject[]> {
  const r = await callModel<{ objects: { id: string; emoji: string; affordances: string[] }[] }>({
    op: 'assign-objects', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charList(characters)}\n\nEnvironment:\n${describeEnvironment(env)}\n\nObjects:\n${objects.map((o) => `- [${o.id}] ${o.name} in room ${o.roomId}`).join('\n')}\n\nFor every object assign: one emoji that depicts it, and 1–4 short interaction verbs a character can do with it in this story (e.g. "sit on", "cook at", "open", "read"). Include the interactions the story mentions.`,
    schema: obj({ objects: { type: 'array', items: obj({ id: str, emoji: str, affordances: strArr }) } }),
  });
  return objects.map((o) => {
    const a = r.objects.find((x) => x.id === o.id);
    return { ...o, emoji: (a?.emoji || '📦').slice(0, 4), affordances: (a?.affordances?.length ? a.affordances : ['use']).slice(0, 4).map((v) => v.slice(0, 24)) };
  });
}

// ---------- Process 2 ----------

/** P2.2 [model generate]~: story_1 + characters_2 + message_1 -> reply_1 */
export async function personaReply(story: string, characters: Character[], characterId: string, message: string): Promise<string> {
  const c = characters.find((x) => x.id === characterId);
  if (!c) throw new Error('Unknown character');
  const r = await callModel<{ reply: string }>({
    op: 'persona-reply', tier: 'author',
    system: `You are role-playing ${c.name}, a character in a short everyday story. Stay fully in character, speak in their voice, 1–3 sentences. Answer only with the requested JSON.`,
    prompt: `Story:\n"""${story}"""\n\nAll characters:\n${charList(characters)}\n\nYou are ${c.name}. Someone says to you: "${message}"\nReply as ${c.name}.`,
    schema: obj({ reply: str }),
  });
  return r.reply.trim();
}

/** P2.4 [model generate]~: story_1 + characters_2 + message_1 + reply_2 -> traits_1 */
export async function suggestTraits(story: string, characters: Character[], characterId: string, message: string, reply: string): Promise<string[]> {
  const c = characters.find((x) => x.id === characterId);
  if (!c) throw new Error('Unknown character');
  const r = await callModel<{ traits: string[] }>({
    op: 'suggest-traits', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nCharacter:\n${charList([c])}\n\nTest dialogue:\nAuthor: "${message}"\n${c.name}: "${reply}"\n\nThe author wrote or corrected ${c.name}'s reply above. Suggest 4–6 short personality traits (1–3 words each) that this reply reveals and that should be added to ${c.name}'s persona. Do not repeat traits already listed.`,
    schema: obj({ traits: strArr }),
  });
  return [...new Set(r.traits.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
}

// ---------- Process 3 ----------

/** P3.1 [model extract]: story_1 + environment_2 + objects_3 + characters_3 -> activities_1 */
export async function extractActivities(story: string, env: Environment, characters: Character[]): Promise<Activity[]> {
  const objIds = env.objects.filter((o) => o.pos).map((o) => o.id);
  const r = await callModel<{ activities: Omit<Activity, 'id'>[] }>({
    op: 'extract-activities', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charList(characters)}\n\nEnvironment (object ids in brackets):\n${describeEnvironment(env)}\n\nExtract, in story order, the concrete actions each character takes. Each activity is one character doing one short action (verb phrase, e.g. "cooks dinner at the stove") with the object it uses, chosen from the object ids above (objectId null only if no object fits). Prefer activities that can be acted out in the scene. 6–16 activities.`,
    schema: obj({ activities: { type: 'array', items: obj({ characterId: { type: 'string', enum: characters.map((c) => c.id) }, action: str, objectId: { anyOf: [{ type: 'string', enum: objIds }, { type: 'null' }] }, description: str }) } }),
  });
  return r.activities
    .filter((a) => characters.some((c) => c.id === a.characterId))
    .map((a, i) => ({ ...a, id: `a${i + 1}`, objectId: a.objectId && objIds.includes(a.objectId) ? a.objectId : null }));
}

/** P3.2 [model compose]: story_1 + environment_2 + characters_3 + activities_1 -> events_1 */
export async function composeEvents(story: string, characters: Character[], activities: Activity[]): Promise<KeyEvent[]> {
  const r = await callModel<{ events: { title: string; activityIds: string[] }[] }>({
    op: 'compose-events', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charList(characters)}\n\nActivities:\n${activities.map((a) => `- ${a.id}: ${characters.find((c) => c.id === a.characterId)?.name} ${a.action}`).join('\n')}\n\nGroup the activities into key events: activities that happen at the same time belong to the same event. Every activity belongs to exactly one event. Give each event a short title.`,
    schema: obj({ events: { type: 'array', items: obj({ title: str, activityIds: strArr }) } }),
  });
  const ids = new Set(activities.map((a) => a.id));
  const used = new Set<string>();
  const events: KeyEvent[] = r.events.map((e, i) => ({
    id: `e${i + 1}`, order: i + 1, title: e.title,
    activityIds: e.activityIds.filter((id) => ids.has(id) && !used.has(id) && used.add(id)),
  })).filter((e) => e.activityIds.length);
  // every activity in exactly one event
  for (const a of activities) if (!used.has(a.id)) events.push({ id: `e${events.length + 1}`, order: events.length + 1, title: a.action, activityIds: [a.id] });
  return events;
}

/** P3.3 [model assign]: story_1 + environment_2 + characters_3 + events_1 -> events_2 (chronological order) */
export async function orderEvents(story: string, events: KeyEvent[], activities: Activity[], characters: Character[]): Promise<KeyEvent[]> {
  const r = await callModel<{ order: { eventId: string; position: number }[] }>({
    op: 'order-events', tier: 'author', system: AUTHOR_SYS,
    prompt: `Story:\n"""${story}"""\n\nEvents:\n${events.map((e) => `- ${e.id} "${e.title}": ${e.activityIds.map((id) => { const a = activities.find((x) => x.id === id)!; return `${characters.find((c) => c.id === a.characterId)?.name} ${a.action}`; }).join('; ')}`).join('\n')}\n\nAssign each event its position (1 = first) in the chronological order of the story.`,
    schema: obj({ order: { type: 'array', items: obj({ eventId: { type: 'string', enum: events.map((e) => e.id) }, position: { type: 'integer' } }) } }),
  });
  const pos = (e: KeyEvent) => r.order.find((o) => o.eventId === e.id)?.position ?? 999 + e.order;
  return [...events].sort((a, b) => pos(a) - pos(b)).map((e, i) => ({ ...e, order: i + 1 }));
}

// ---------- Process 4–6 (play) ----------

function runtimeContext(v: Vignette, s: RuntimeState): string {
  const ev = currentEvent(v, s);
  const pend = pendingActivities(v, s);
  const name = (id: string) => v.characters.find((c) => c.id === id)?.name ?? id;
  const objName = (id: string | null) => (id ? v.environment.objects.find((o) => o.id === id)?.name : null);
  return `Characters:\n${charList(v.characters)}

Environment (object ids in brackets):\n${describeEnvironment(v.environment)}

Where everyone is:\n${v.characters.map((c) => { const p = s.positions[c.id]; const room = v.environment.rooms.find((r) => p && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h); return `- ${c.name} in the ${room?.label ?? 'doorway'}${s.doing[c.id] ? `, last: ${s.doing[c.id]}` : ''}`; }).join('\n')}

Key events (authored, in order):\n${v.events.map((e, i) => `${i + 1}. ${e.title}${i < s.eventIndex ? ' (done)' : i === s.eventIndex ? ' (NEXT)' : ''}`).join('\n')}

Next key event: ${ev ? `"${ev.title}" — still to happen: ${pend.map((a) => `${name(a.characterId)} ${a.action}${objName(a.objectId) ? ` (${objName(a.objectId)})` : ''}`).join('; ')}` : 'none, the story is over'}

Recent happenings:\n${s.log.slice(-8).join('\n') || '(start of scene)'}`;
}

/** P4.2 [model generate]~: story_1 + vignette_1 + runtime_state_1 + scene_1 -> npc_plans_1 */
export async function planNpcs(v: Vignette, s: RuntimeState): Promise<NpcPlan[]> {
  const npcs = npcsOf(v);
  const player = playerOf(v);
  const objIds = v.environment.objects.map((o) => o.id);
  const act = obj({ action: str, objectId: { anyOf: [{ type: 'string', enum: objIds }, { type: 'null' }] }, say: str });
  const r = await callModel<{ plans: { characterId: string; follow: any; diverge: any }[] }>({
    op: 'plan-npcs', tier: 'play',
    system: 'You are the Controlled Divergence Module of an interactive story game. You plan what non-player characters do next so they react naturally to the player while the authored key events are preserved. Answer only with the requested JSON.',
    prompt: `Story:\n"""${v.story}"""\n\n${runtimeContext(v, s)}

The player controls ${player.name}. For EACH non-player character (${npcs.map((c) => `${c.name} [${c.id}]`).join(', ')}) plan two possible next activities:
- follow: what they do if the player now does the player's part of the next key event (if the NPC has its own part in that event, it does that part).
- diverge: what they do if the player does something else instead; stay in character, react to the player, and where natural gently steer the player back toward the next key event, without performing future key events themselves.
Each activity: a short verb phrase, the object id it uses (or null), and an optional short line the character says out loud (empty string if nothing).`,
    schema: obj({ plans: { type: 'array', items: obj({ characterId: { type: 'string', enum: npcs.map((c) => c.id) }, follow: act, diverge: act }) } }),
  });
  return validatePlans(v, s, r.plans as NpcPlan[]);
}

/** P5.2 [model generate]~: vignette_1 + runtime_state_1 + player_message_1 -> npc_reply_1 */
export async function npcReply(v: Vignette, s: RuntimeState, characterId: string, message: string): Promise<string> {
  const c = v.characters.find((x) => x.id === characterId && !x.isPlayer);
  if (!c) throw new Error('Unknown character');
  const player = playerOf(v);
  const r = await callModel<{ reply: string }>({
    op: 'npc-reply', tier: 'play',
    system: `You are ${c.name}, a character in an interactive story game. Stay in character and keep replies to 1–2 short sentences. Answer only with the requested JSON.`,
    prompt: `Story:\n"""${v.story}"""\n\n${runtimeContext(v, s)}\n\n${player.name} (the player) says to you: "${message}"\n\nReply as ${c.name}, consistent with your persona. If the message tries to skip, rush past, or avoid the next key event, do not go along with it: respond in character and encourage ${player.name} to return to it.`,
    schema: obj({ reply: str }),
  });
  return r.reply.trim().slice(0, 300);
}

/** P6.2 [model generate]~: vignette_1 + runtime_state_1 + deviation_1 -> inner_voice_1 */
export async function innerVoice(v: Vignette, s: RuntimeState, action: PlayerAction): Promise<string> {
  const player = playerOf(v);
  const did = action.kind === 'interact' ? `${action.verb} ${v.environment.objects.find((o) => o.id === action.objectId)?.name ?? ''}` : 'nothing for a while';
  const r = await callModel<{ thought: string }>({
    op: 'inner-voice', tier: 'play',
    system: 'You write the inner voice of the player character in an interactive story game. Answer only with the requested JSON.',
    prompt: `Story:\n"""${v.story}"""\n\n${runtimeContext(v, s)}\n\nThe player (${player.name}) just did: ${did}. That is not their part of the next key event. Write one short first-person thought (max 15 words) of ${player.name} that hints at what they should do next, without giving orders.`,
    schema: obj({ thought: str }),
  });
  return r.thought.trim().slice(0, 140);
}
