// One function per [model op] in design.json. Each builds its prompt only from the
// representations in the preceding state, asks for structured output, and validates it.
import { callModel } from "./llm";
import { LAYOUTS, getLayout } from "../src/shared/layouts";
import { snapObjects } from "../src/shared/environment";
import { charName } from "../src/shared/engine";
import type {
  Activity,
  Character,
  Deviation,
  Environment,
  GameObject,
  Layout,
  NpcPlan,
  NpcStep,
  PlotEvent,
  RoomLabel,
  RuntimeState,
  Vignette,
} from "../src/shared/types";

const COLORS = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#a8c686", "#8e5572", "#2a9d8f", "#d62828"];
const str = { type: "string" } as const;
const arr = (items: object, extra: object = {}) => ({ type: "array", items, ...extra });
const obj = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const clean = (s: unknown, max = 400) => String(s ?? "").trim().slice(0, max);

function charactersText(cs: Character[]) {
  return cs
    .map((c) => `- ${c.id}: ${c.name}${c.isPlayer ? " (player)" : ""} — ${c.description}${c.traits.length ? ` Traits: ${c.traits.join(", ")}.` : ""}`)
    .join("\n");
}

function layoutText(l: Layout) {
  return l.rooms.map((r) => `- ${r.id}: ${r.w}x${r.h} tiles at (${r.x},${r.y})`).join("\n");
}

function envText(env: Environment) {
  return env.rooms
    .map((r) => `- ${r.id} "${r.name}": x ${r.x}..${r.x + r.w - 1}, y ${r.y}..${r.y + r.h - 1}. ${r.description}`)
    .join("\n");
}

function objectsText(os: GameObject[]) {
  return os.map((o) => `- ${o.id}: ${o.emoji} ${o.name} in ${o.roomId}${o.x != null ? ` at (${o.x},${o.y})` : ""} — ${o.description}`).join("\n");
}

function activitiesText(as: Activity[], os: GameObject[]) {
  return as.map((a) => `- ${a.id}: ${a.verb} ${os.find((o) => o.id === a.objectId)?.name ?? a.objectId} — ${a.description}`).join("\n");
}

function eventsText(es: PlotEvent[]) {
  return es
    .map((e, i) => `${i + 1}. ${e.id}: ${e.description} [activity: ${e.activityId ?? "none"}, room: ${e.roomId ?? "none"}, characters: ${e.characterIds.join(", ") || "none"}]`)
    .join("\n");
}

const SYSTEM_BASE =
  "You are a component of a tool that turns a short story into a small playable top-down vignette game. Follow the output schema exactly. Stay faithful to the story.";

// ======================================================================= Process 1

/** P1.1 [model extract]: story + layouts → characters */
export async function extractCharacters(story: string): Promise<Character[]> {
  const out = await callModel<{ characters: { name: string; description: string; traits: string[]; isProtagonist: boolean }[] }>({
    system: `${SYSTEM_BASE} Task: extract the characters who appear in the story.`,
    prompt: `Story:\n"""${story}"""\n\nList the 1–6 most important characters who physically appear. For each give a name, a one- or two-sentence description (role, appearance, relationships), 2–4 short personality traits, and whether they are the protagonist (exactly one).`,
    schema: obj({
      characters: arr(obj({ name: str, description: str, traits: arr(str), isProtagonist: { type: "boolean" } }), { minItems: 1, maxItems: 6 }),
    }),
  });
  const seen = new Set<string>();
  const list = (out.characters ?? [])
    .filter((c) => c.name && !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
    .slice(0, 6);
  if (!list.length) throw new Error("The model found no characters in the story.");
  let protagonist = list.findIndex((c) => c.isProtagonist);
  if (protagonist < 0) protagonist = 0;
  return list.map((c, i) => ({
    id: `c${i + 1}`,
    name: clean(c.name, 60),
    description: clean(c.description),
    traits: (c.traits ?? []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 6),
    isPlayer: i === protagonist,
    color: COLORS[i % COLORS.length],
    x: null,
    y: null,
  }));
}

/** P1.2 [model select]: story + layouts + characters → layout */
export async function selectLayout(story: string, characters: Character[]): Promise<{ layoutId: string; reason: string }> {
  const options = LAYOUTS.map((l) => `- ${l.id}: ${l.name}, ${l.width}x${l.height} tiles, rooms:\n${layoutText(l)}`).join("\n");
  const out = await callModel<{ layoutId: string; reason: string }>({
    system: `${SYSTEM_BASE} Task: choose the floor plan that best fits the places where the story happens.`,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charactersText(characters)}\n\nAvailable floor plans:\n${options}\n\nPick the one floor plan whose number and sizes of rooms best match the distinct indoor locations the story needs. Give the id and a one-sentence reason.`,
    schema: obj({ layoutId: { type: "string", enum: LAYOUTS.map((l) => l.id) }, reason: str }),
  });
  if (!getLayout(out.layoutId)) return { layoutId: LAYOUTS[1].id, reason: "Fallback: the model chose an unknown layout." };
  return { layoutId: out.layoutId, reason: clean(out.reason) };
}

/** P1.3 [model assign]: story + layout + characters → room_labels */
export async function assignRoomLabels(story: string, layoutId: string, characters: Character[]): Promise<RoomLabel[]> {
  const layout = getLayout(layoutId);
  if (!layout) throw new Error("Unknown layout");
  const out = await callModel<{ labels: RoomLabel[] }>({
    system: `${SYSTEM_BASE} Task: assign a story location to every room of a floor plan.`,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charactersText(characters)}\n\nFloor plan "${layout.name}" rooms (x grows right, y grows down):\n${layoutText(layout)}\n\nGive every room id a short location name from the story world (e.g. "Kitchen", "Captain's cabin") and a one-sentence description. Larger rooms should hold the more important locations. Use each room id exactly once.`,
    schema: obj({ labels: arr(obj({ roomId: { type: "string", enum: layout.rooms.map((r) => r.id) }, name: str, description: str })) }),
  });
  return layout.rooms.map((r, i) => {
    const l = out.labels?.find((x) => x.roomId === r.id);
    return { roomId: r.id, name: clean(l?.name, 40) || `Room ${i + 1}`, description: clean(l?.description, 200) };
  });
}

/** P1.5 [model generate]~: story + layout + characters + room_labels → objects */
export async function generateObjects(story: string, layoutId: string, characters: Character[], roomLabels: RoomLabel[]): Promise<GameObject[]> {
  const layout = getLayout(layoutId);
  if (!layout) throw new Error("Unknown layout");
  const rooms = layout.rooms
    .map((r) => {
      const l = roomLabels.find((x) => x.roomId === r.id);
      return `- ${r.id} "${l?.name ?? r.id}" (${r.w}x${r.h} tiles): ${l?.description ?? ""}`;
    })
    .join("\n");
  const out = await callModel<{ objects: { name: string; emoji: string; description: string; roomId: string }[] }>({
    system: `${SYSTEM_BASE} Task: furnish the rooms with objects characters can interact with.`,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charactersText(characters)}\n\nRooms:\n${rooms}\n\nGenerate 2–5 objects per room (more for larger rooms) that fit the location and that the story's actions could use. Each object needs a short name, a single emoji that depicts it, a one-sentence description, and the room id it belongs to. Include every object the story's plot explicitly needs.`,
    schema: obj({
      objects: arr(obj({ name: str, emoji: str, description: str, roomId: { type: "string", enum: layout.rooms.map((r) => r.id) } })),
    }),
  });
  const roomIds = new Set(layout.rooms.map((r) => r.id));
  return (out.objects ?? [])
    .filter((o) => o.name && roomIds.has(o.roomId))
    .slice(0, 40)
    .map((o, i) => ({
      id: `o${i + 1}`,
      name: clean(o.name, 40),
      emoji: [...clean(o.emoji, 8)].slice(0, 2).join("") || "📦",
      description: clean(o.description, 200),
      roomId: o.roomId,
      x: null,
      y: null,
    }));
}

/** P1.7 [model assign]: story + environment + characters + objects → objects with positions */
export async function placeObjects(story: string, environment: Environment, objects: GameObject[]): Promise<GameObject[]> {
  const doors: string[] = [];
  environment.tiles.forEach((row, y) => row.forEach((t, x) => t === "door" && doors.push(`(${x},${y})`)));
  const out = await callModel<{ placements: { id: string; x: number; y: number }[] }>({
    system: `${SYSTEM_BASE} Task: place furniture and props on a tile grid.`,
    prompt: `Story:\n"""${story}"""\n\nRooms (floor tiles, inclusive ranges):\n${envText(environment)}\nDoor tiles: ${doors.join(" ")}\n\nObjects:\n${objectsText(objects)}\n\nGive each object an (x,y) floor tile inside its own room. Put furniture that belongs against walls on edge tiles, keep tiles next to doors free, keep paths through rooms open, and never put two objects on the same tile.`,
    schema: obj({ placements: arr(obj({ id: { type: "string", enum: objects.map((o) => o.id) }, x: { type: "integer" }, y: { type: "integer" } })) }),
  });
  const placed = objects.map((o) => {
    const p = out.placements?.find((q) => q.id === o.id);
    return p ? { ...o, x: Math.round(p.x), y: Math.round(p.y) } : o;
  });
  return snapObjects(environment, placed);
}

// ======================================================================= Process 2

/** P2.2 [model generate]~: story + characters + message → reply (in character) */
export async function interviewReply(story: string, character: Character, characters: Character[], message: string): Promise<string> {
  const out = await callModel<{ reply: string }>({
    system: `${SYSTEM_BASE} Task: answer an interviewer in character, so the author can discover how this character talks and thinks.`,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charactersText(characters)}\n\nYou are ${character.name} (${character.id}). Answer the author's question in first person, in your own voice, in 1–4 sentences.\n\nQuestion: ${message}`,
    schema: obj({ reply: str }),
  });
  const reply = clean(out.reply, 1200);
  if (!reply) throw new Error("Empty reply");
  return reply;
}

/** P2.4 [model generate]~: story + characters + reply → traits */
export async function suggestTraits(story: string, character: Character, reply: string): Promise<string[]> {
  const out = await callModel<{ traits: string[] }>({
    system: `${SYSTEM_BASE} Task: infer personality traits from how a character speaks.`,
    prompt: `Story:\n"""${story}"""\n\nCharacter: ${character.name} — ${character.description}\nCurrent traits: ${character.traits.join(", ") || "none"}\n\nThe character said:\n"""${reply}"""\n\nSuggest 3–6 short personality traits (1–3 words each) that this answer reveals. Do not repeat current traits.`,
    schema: obj({ traits: arr(str, { minItems: 1, maxItems: 6 }) }),
  });
  const existing = new Set(character.traits.map((t) => t.toLowerCase()));
  const traits = [...new Set((out.traits ?? []).map((t) => clean(t, 40)).filter((t) => t && !existing.has(t.toLowerCase())))];
  if (!traits.length) throw new Error("No new traits suggested");
  return traits.slice(0, 6);
}

// ======================================================================= Process 3

/** P3.1 [model extract]: story + environment + objects + characters → activities */
export async function extractActivities(story: string, environment: Environment, objects: GameObject[], characters: Character[]): Promise<Activity[]> {
  const out = await callModel<{ activities: { objectId: string; verb: string; description: string }[] }>({
    system: `${SYSTEM_BASE} Task: list what characters can do with each object.`,
    prompt: `Story:\n"""${story}"""\n\nRooms:\n${envText(environment)}\n\nObjects:\n${objectsText(objects)}\n\nCharacters:\n${charactersText(characters)}\n\nFor each object list 1–3 activities a character could perform with it, especially those the story's events require. Each has the object id, a short imperative verb phrase (e.g. "read", "pour tea into"), and a one-sentence description.`,
    schema: obj({ activities: arr(obj({ objectId: { type: "string", enum: objects.map((o) => o.id) }, verb: str, description: str })) }),
  });
  const ids = new Set(objects.map((o) => o.id));
  return (out.activities ?? [])
    .filter((a) => ids.has(a.objectId) && a.verb)
    .slice(0, 80)
    .map((a, i) => ({ id: `a${i + 1}`, objectId: a.objectId, verb: clean(a.verb, 40), description: clean(a.description, 200) }));
}

/** P3.2 [model compose]: story + environment + objects + characters + activities → events */
export async function composeEvents(
  story: string,
  environment: Environment,
  objects: GameObject[],
  characters: Character[],
  activities: Activity[],
): Promise<PlotEvent[]> {
  const out = await callModel<{ events: { description: string; activityId: string; roomId: string }[] }>({
    system: `${SYSTEM_BASE} Task: turn the story into an ordered sequence of playable plot events.`,
    prompt: `Story:\n"""${story}"""\n\nRooms:\n${envText(environment)}\n\nObjects:\n${objectsText(objects)}\n\nActivities:\n${activitiesText(activities, objects)}\n\nCharacters:\n${charactersText(characters)}\n\nCompose 3–8 events that retell the story in order. Each event is completed in the game either by performing one activity (give its activityId) or, if no activity fits, by characters reaching a room (give roomId and activityId "none"). Write the description as one present-tense sentence.`,
    schema: obj({
      events: arr(
        obj({
          description: str,
          activityId: { type: "string", enum: [...activities.map((a) => a.id), "none"] },
          roomId: { type: "string", enum: [...environment.rooms.map((r) => r.id), "none"] },
        }),
        { minItems: 1, maxItems: 10 },
      ),
    }),
  });
  const aIds = new Set(activities.map((a) => a.id));
  const rIds = new Set(environment.rooms.map((r) => r.id));
  const events = (out.events ?? []).filter((e) => e.description).slice(0, 10);
  if (!events.length) throw new Error("No events composed");
  return events.map((e, i) => ({
    id: `e${i + 1}`,
    description: clean(e.description, 300),
    activityId: aIds.has(e.activityId) ? e.activityId : null,
    roomId: rIds.has(e.roomId) ? e.roomId : null,
    characterIds: [],
  }));
}

/** P3.3 [model assign]: story + characters + events → events with characters */
export async function assignEventCharacters(story: string, characters: Character[], events: PlotEvent[]): Promise<PlotEvent[]> {
  const out = await callModel<{ assignments: { eventId: string; characterIds: string[] }[] }>({
    system: `${SYSTEM_BASE} Task: decide which characters take part in each plot event.`,
    prompt: `Story:\n"""${story}"""\n\nCharacters:\n${charactersText(characters)}\n\nEvents:\n${eventsText(events)}\n\nFor every event list the ids of the characters who take part. The character who performs the event's activity comes first. Involve the player character in the events the protagonist drives.`,
    schema: obj({
      assignments: arr(obj({ eventId: { type: "string", enum: events.map((e) => e.id) }, characterIds: arr({ type: "string", enum: characters.map((c) => c.id) }) })),
    }),
  });
  const cIds = new Set(characters.map((c) => c.id));
  return events.map((e) => {
    const a = out.assignments?.find((x) => x.eventId === e.id);
    return { ...e, characterIds: [...new Set((a?.characterIds ?? []).filter((id) => cIds.has(id)))] };
  });
}

// ======================================================================= Process 4

function runtimeText(v: Vignette, s: RuntimeState) {
  const pos = v.characters
    .map((c) => {
      const p = s.positions[c.id];
      const room = p ? v.environment.rooms.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) : null;
      return `- ${c.id} ${c.name}${c.id === v.playerId ? " (player)" : ""}: at (${p?.x},${p?.y}) in ${room?.name ?? "a doorway"}`;
    })
    .join("\n");
  const ev = v.events[s.eventIndex];
  const recent = s.log.slice(-10).map((l) => `[t${l.tick}] ${l.speaker ? l.speaker + ": " : ""}${l.text}`).join("\n");
  return `Tick ${s.tick}. Current event (${s.eventIndex + 1}/${v.events.length}): ${ev ? `${ev.description} [activity ${ev.activityId ?? "none"}, room ${ev.roomId ?? "none"}, characters ${ev.characterIds.join(", ")}]` : "none (story over)"}\nPositions:\n${pos}\nRecent log:\n${recent}`;
}

function vignetteText(v: Vignette) {
  return `Vignette "${v.title}".\nStory:\n"""${v.story}"""\nRooms:\n${envText(v.environment)}\nObjects:\n${objectsText(v.objects)}\nActivities:\n${activitiesText(v.activities, v.objects)}\nCharacters:\n${charactersText(v.characters)}\nPlot events:\n${eventsText(v.events)}`;
}

/** P4.2 [model generate]~: story + vignette + runtime_state (+ scene) → npc_plans */
export async function planNpcs(v: Vignette, s: RuntimeState): Promise<NpcPlan[]> {
  const npcs = v.characters.filter((c) => c.id !== v.playerId && s.positions[c.id]);
  if (!npcs.length) return [];
  const out = await callModel<{ plans: { characterId: string; steps: { kind: string; target: string; text: string }[] }[] }>({
    tier: "runtime",
    system: `${SYSTEM_BASE} Task: plan the next few actions of the non-player characters so the current plot event can happen and they behave believably.`,
    prompt: `${vignetteText(v)}\n\n${runtimeText(v, s)}\n\nFor each non-player character (${npcs.map((c) => c.id).join(", ")}) give 1–4 steps. Step kinds: "goto" (target = object id), "activity" (target = activity id; they walk there automatically), "say" (text = a short line in character), "wait". NPCs that take part in the current event should work toward it, unless the player must do it; the others go about plausible business. Use "" for unused fields.`,
    schema: obj({
      plans: arr(
        obj({
          characterId: { type: "string", enum: npcs.map((c) => c.id) },
          steps: arr(obj({ kind: { type: "string", enum: ["goto", "activity", "say", "wait"] }, target: str, text: str }), { maxItems: 4 }),
        }),
      ),
    }),
  });
  const oIds = new Set(v.objects.map((o) => o.id));
  const aIds = new Set(v.activities.map((a) => a.id));
  return npcs.map((c) => {
    const p = out.plans?.find((x) => x.characterId === c.id);
    const steps: NpcStep[] = [];
    for (const st of p?.steps ?? []) {
      if (st.kind === "goto" && oIds.has(st.target)) steps.push({ kind: "goto", objectId: st.target });
      else if (st.kind === "activity" && aIds.has(st.target)) steps.push({ kind: "activity", activityId: st.target });
      else if (st.kind === "say" && st.text.trim()) steps.push({ kind: "say", text: clean(st.text, 160) });
      else if (st.kind === "wait") steps.push({ kind: "wait" });
    }
    return { characterId: c.id, eventIndex: s.eventIndex, steps: steps.slice(0, 4) };
  });
}

// ======================================================================= Process 5

/** P5.2 [model generate]~: vignette + runtime_state + player_message → npc_reply */
export async function npcReply(v: Vignette, s: RuntimeState, npcId: string, playerMessage: string): Promise<string> {
  const npc = v.characters.find((c) => c.id === npcId);
  if (!npc) throw new Error("Unknown character");
  const out = await callModel<{ reply: string }>({
    tier: "runtime",
    system: `${SYSTEM_BASE} Task: speak as a non-player character responding to the player.`,
    prompt: `${vignetteText(v)}\n\n${runtimeText(v, s)}\n\nYou are ${npc.name} (${npc.id}). ${charName(v, v.playerId)} (the player) says to you: "${playerMessage}"\nReply in character in 1–2 short sentences. Stay consistent with the story and the current event; you may gently steer the player toward it.`,
    schema: obj({ reply: str }),
  });
  return clean(out.reply, 400) || "…";
}

// ======================================================================= Process 6

/** P6.2 [model generate]~: vignette + runtime_state + deviation → inner_voice */
export async function innerVoice(v: Vignette, s: RuntimeState, deviation: Deviation): Promise<string> {
  const out = await callModel<{ text: string }>({
    tier: "runtime",
    system: `${SYSTEM_BASE} Task: be the player character's inner voice, nudging them back toward the story without breaking immersion.`,
    prompt: `${vignetteText(v)}\n\n${runtimeText(v, s)}\n\nThe player (${charName(v, v.playerId)}) is drifting from the plot (deviation: ${deviation}). Write one short second-person thought (max 25 words) in the character's voice that hints at what they should do next for the current event. ${deviation === "major" ? "Be more insistent." : "Be subtle."}`,
    schema: obj({ text: str }),
  });
  return clean(out.text, 240) || "Something tells you this isn't what you came here for.";
}
