// One function per [model …] operation in design.json. Each builds its prompt only from the
// representations in the state that precedes the step, calls callModel(), and validates the output.
import { callModel } from './llm.js';
import { VERBS, EFFECT_TYPES } from '../public/tools/engine.js';

const SYSTEM = 'You are a component of an application that turns a story into a small playable 2D world. ' +
  'Respond only with the requested JSON. Stay faithful to the story. Keep text short and vivid.';

const PALETTE = ['#f4a259', '#5b8e7d', '#bc4b51', '#8cb369', '#7d5ba6', '#3d7ea6', '#e07a5f', '#c9a227'];
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (msg) => { const e = new Error(msg); e.status = 422; throw e; };
const json = (x) => JSON.stringify(x, null, 1);

const charBrief = (cs) => cs.map((c) => ({ id: c.id, name: c.name, description: c.description, persona: c.persona || undefined, trait: c.trait || undefined, isPlayer: c.isPlayer }));
const regionBrief = (map, labels) => map.regions.map((r) => ({ id: r.id, kind: r.kind, name: labels?.find((l) => l.regionId === r.id)?.name || r.hint }));

/* ===================== Process 1 ===================== */

// [model extract]  r1 + r2* → r3*
export async function extractCharacters({ story, templates }) {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }, description: { type: 'string' },
            emoji: { type: 'string' }, isPlayer: { type: 'boolean' },
          },
          required: ['name', 'description', 'emoji', 'isPlayer'],
        },
      },
    },
    required: ['title', 'characters'],
  };
  const out = await callModel({
    label: 'extractCharacters', system: SYSTEM, schema,
    prompt: `Extract the characters of this story (2 to 6, most important first) and a short title.
Mark exactly one as the player character (the protagonist). For each give a one-sentence description and a single emoji that depicts them.
The world will later be built on one of these maps: ${templates.map((t) => t.name).join(', ')}.

STORY:
${story}`,
  });
  let chars = (out.characters || []).filter((c) => str(c.name)).slice(0, 6);
  if (!chars.length) fail('The model found no characters in the story.');
  const playerIdx = Math.max(0, chars.findIndex((c) => c.isPlayer));
  chars = chars.map((c, i) => ({
    id: `c${i + 1}`,
    name: str(c.name, 40),
    description: str(c.description, 300),
    emoji: str(c.emoji, 8) || '🙂',
    color: PALETTE[i % PALETTE.length],
    isPlayer: i === playerIdx,
    persona: '',
    trait: '',
  }));
  return { title: str(out.title, 80) || 'Untitled story', characters: chars };
}

// [model select]  r1 + r2* + r3* → r4
export async function selectTemplate({ story, templates, characters }) {
  const schema = { type: 'object', properties: { templateId: { type: 'string', enum: templates.map((t) => t.id) }, reason: { type: 'string' } }, required: ['templateId', 'reason'] };
  const out = await callModel({
    label: 'selectTemplate', system: SYSTEM, schema,
    prompt: `Choose the map that best fits where this story takes place.
MAPS:
${templates.map((t) => `- ${t.id}: ${t.description} Regions: ${t.regions.map((r) => r.hint).join(', ')}`).join('\n')}

CHARACTERS: ${json(charBrief(characters))}

STORY:
${story}`,
  });
  if (!templates.some((t) => t.id === out.templateId)) fail(`Model chose an unknown map "${out.templateId}".`);
  return { templateId: out.templateId, reason: str(out.reason, 800) };
}

// [model assign]  r1 + r4 + r3* → r5*
export async function assignRegionLabels({ story, map, characters }) {
  const schema = { type: 'object', properties: { labels: { type: 'array', items: { type: 'object', properties: { regionId: { type: 'string' }, name: { type: 'string' } }, required: ['regionId', 'name'] } } }, required: ['labels'] };
  const out = await callModel({
    label: 'assignRegionLabels', system: SYSTEM, schema,
    prompt: `Name every region of this map after a place in the story (max 3 words each, all different). If the story has fewer places, invent fitting ones.
REGIONS (id, kind, generic hint): ${json(map.regions.map((r) => ({ id: r.id, kind: r.kind, hint: r.hint })))}
CHARACTERS: ${json(charBrief(characters))}

STORY:
${story}`,
  });
  return {
    labels: map.regions.map((r) => {
      const found = (out.labels || []).find((l) => l.regionId === r.id);
      return { regionId: r.id, name: str(found?.name, 28) || r.hint };
    }),
  };
}

// [model generate]~  r1 + r4 + r3* + r5* → r6*
export async function generateObjects({ story, map, regionLabels, characters }) {
  const ids = map.regions.map((r) => r.id);
  const schema = { type: 'object', properties: { objects: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, emoji: { type: 'string' }, regionId: { type: 'string', enum: ids } }, required: ['name', 'description', 'emoji', 'regionId'] } } }, required: ['objects'] };
  const out = await callModel({
    label: 'generateObjects', system: SYSTEM, schema,
    prompt: `Generate the objects (props) that should exist in this world so the story can be played: 4 to 12 objects, each in one region, with a one-sentence description and one emoji.
Include every object the plot depends on.
REGIONS: ${json(regionBrief(map, regionLabels))}
CHARACTERS: ${json(charBrief(characters))}

STORY:
${story}`,
  });
  const objects = (out.objects || []).filter((o) => str(o.name) && ids.includes(o.regionId)).slice(0, 12).map((o, i) => ({
    id: `o${i + 1}`, name: str(o.name, 40), description: str(o.description, 300), emoji: str(o.emoji, 8) || '📦',
    region: o.regionId, affordances: [], owner: null, hidden: false,
  }));
  if (!objects.length) fail('The model generated no valid objects.');
  return { objects };
}

// [model assign]  r1 + r7 + r3* + r6* → r6_2*
export async function assignAffordances({ story, objects, placementRegions, characters }) {
  const AFF = ['take', 'use', 'open'];
  const schema = { type: 'object', properties: { assignments: { type: 'array', items: { type: 'object', properties: { objectId: { type: 'string' }, affordances: { type: 'array', items: { type: 'string', enum: AFF } }, owner: { type: ['string', 'null'] }, hidden: { type: 'boolean' } }, required: ['objectId', 'affordances', 'owner', 'hidden'] } } }, required: ['assignments'] };
  const out = await callModel({
    label: 'assignAffordances', system: SYSTEM, schema,
    prompt: `For each object, assign: which actions the player can perform on it (subset of ${AFF.join(', ')}; "take" only for portable things), its owner (a character id or null), and whether it starts hidden (true only if the story has it discovered later).
OBJECTS (with the region each is placed in): ${json(objects.map((o) => ({ id: o.id, name: o.name, description: o.description, region: placementRegions[o.id] })))}
CHARACTERS: ${json(charBrief(characters))}

STORY:
${story}`,
  });
  const charIds = characters.map((c) => c.id);
  return {
    objects: objects.map((o) => {
      const a = (out.assignments || []).find((x) => x.objectId === o.id) || {};
      return {
        ...o,
        affordances: [...new Set((a.affordances || []).filter((v) => AFF.includes(v)))],
        owner: charIds.includes(a.owner) ? a.owner : null,
        hidden: !!a.hidden,
      };
    }),
  };
}

/* ===================== Process 2 ===================== */

// [model generate]~  r1 + r3* + r8 → r9
export async function generateProfile({ story, characters, characterId, request }) {
  const ch = characters.find((c) => c.id === characterId) || fail('Unknown character.');
  const schema = { type: 'object', properties: { profile: { type: 'string' } }, required: ['profile'] };
  const out = await callModel({
    label: 'generateProfile', system: SYSTEM, schema,
    prompt: `Write a persona for the character "${ch.name}" (id ${ch.id}) to be used when they are played in a game: 3 to 6 sentences covering personality, how they speak, what they want and what they know. Follow the user's request.
USER REQUEST: ${request || '(none — base it on the story)'}
ALL CHARACTERS: ${json(charBrief(characters))}

STORY:
${story}`,
  });
  const profile = str(out.profile, 1500);
  if (!profile) fail('Empty profile.');
  return { profile };
}

// [model generate]~  r1 + r3* + r9_2 → r10*
export async function generateTraits({ story, characters, characterId, profile }) {
  const ch = characters.find((c) => c.id === characterId) || fail('Unknown character.');
  const schema = { type: 'object', properties: { traits: { type: 'array', items: { type: 'string' } } }, required: ['traits'] };
  const out = await callModel({
    label: 'generateTraits', system: SYSTEM, schema,
    prompt: `Propose 5 alternative one-to-three-word trait labels that capture "${ch.name}" as described by this persona. They should differ from each other.
PERSONA: ${profile}
ALL CHARACTERS: ${json(charBrief(characters))}

STORY:
${story}`,
  });
  const traits = [...new Set((out.traits || []).map((t) => str(t, 32)).filter((t) => t && t.split(/\s+/).length <= 4))].slice(0, 6);
  if (!traits.length) fail('No valid trait labels were generated.');
  return { traits };
}

/* ===================== Process 3 ===================== */

const worldBrief = ({ map, regionLabels, placementRegions, objects, characters }) => `REGIONS: ${json(regionBrief(map, regionLabels))}
CHARACTERS (with region): ${json(charBrief(characters).map((c) => ({ ...c, region: placementRegions[c.id] })))}
OBJECTS (with region): ${json(objects.map((o) => ({ id: o.id, name: o.name, description: o.description, region: placementRegions[o.id], affordances: o.affordances, owner: o.owner, hidden: o.hidden })))}`;

// [model extract]  r1 + r7 + r6* + r3* → r12*
export async function extractEvents(input) {
  const schema = { type: 'object', properties: { events: { type: 'array', items: { type: 'object', properties: { summary: { type: 'string' }, actorId: { type: 'string' }, regionId: { type: 'string' }, objectIds: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'actorId', 'regionId', 'objectIds'] } } }, required: ['events'] };
  const out = await callModel({
    label: 'extractEvents', system: SYSTEM, schema,
    prompt: `List the key events of the story in order (3 to 10), each linked to the world: who does it (character id), where (region id) and which objects are involved (object ids).
${worldBrief(input)}

STORY:
${input.story}`,
  });
  const cids = input.characters.map((c) => c.id), rids = input.map.regions.map((r) => r.id), oids = input.objects.map((o) => o.id);
  const events = (out.events || []).filter((e) => str(e.summary)).slice(0, 10).map((e, i) => ({
    id: `e${i + 1}`, summary: str(e.summary, 300),
    actorId: cids.includes(e.actorId) ? e.actorId : null,
    regionId: rids.includes(e.regionId) ? e.regionId : null,
    objectIds: (e.objectIds || []).filter((o) => oids.includes(o)),
  }));
  if (!events.length) fail('No events extracted.');
  return { events };
}

const effectSchema = { type: 'object', properties: { type: { type: 'string', enum: EFFECT_TYPES }, text: { type: 'string' }, flag: { type: 'string' }, object: { type: 'string' }, character: { type: 'string' }, region: { type: 'string' } }, required: ['type'] };

/** Validate scripts against the world so the engine can always run them. */
export function validateScripts(raw, { characters, objects, map }) {
  const cids = characters.map((c) => c.id), oids = objects.map((o) => o.id), rids = map.regions.map((r) => r.id);
  const targetOk = (verb, t) => (verb === 'go' ? rids.includes(t) : cids.includes(t) || oids.includes(t));
  return (raw || []).map((s, i) => {
    const trigger = s.trigger || {};
    if (!VERBS.includes(trigger.verb) || !targetOk(trigger.verb, trigger.target)) return null;
    if (trigger.verb === 'give' && !oids.includes(trigger.item)) return null;
    const effects = (s.effects || []).filter((e) => {
      switch (e.type) {
        case 'narrate': return !!str(e.text);
        case 'end_story': return true;
        case 'set_flag': return !!str(e.flag);
        case 'give_item': case 'remove_object': case 'reveal_object': return oids.includes(e.object);
        case 'move_character': return cids.includes(e.character) && rids.includes(e.region);
        default: return false;
      }
    }).map((e) => Object.fromEntries(Object.entries(e).filter(([k, v]) => v !== '' && v != null && ['type', 'text', 'flag', 'object', 'character', 'region'].includes(k))));
    if (!effects.length) return null;
    return {
      id: s.id && /^s\d+$/.test(s.id) ? s.id : `s${i + 1}`,
      title: str(s.title, 80) || `Script ${i + 1}`,
      eventId: s.eventId || null,
      trigger: { verb: trigger.verb, target: trigger.target, ...(trigger.verb === 'give' ? { item: trigger.item } : {}) },
      requires: (s.requires || []).map((f) => str(f, 40)).filter(Boolean),
      effects,
      repeatable: !!s.repeatable,
      npc: s.npc && cids.includes(s.npc) ? s.npc : null,
      region: s.region && rids.includes(s.region) ? s.region : null,
    };
  }).filter(Boolean);
}

// [model compose]  r1 + r7 + r3* + r6* + r12* → r13*
export async function composeScripts(input) {
  const schema = { type: 'object', properties: { scripts: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string' }, eventId: { type: 'string' },
    trigger: { type: 'object', properties: { verb: { type: 'string', enum: VERBS }, target: { type: 'string' }, item: { type: 'string' } }, required: ['verb', 'target'] },
    requires: { type: 'array', items: { type: 'string' } }, effects: { type: 'array', items: effectSchema }, repeatable: { type: 'boolean' },
  }, required: ['title', 'eventId', 'trigger', 'requires', 'effects', 'repeatable'] } } }, required: ['scripts'] };
  const out = await callModel({
    label: 'composeScripts', system: SYSTEM, schema,
    prompt: `Turn the story events into game scripts that let the player re-live the story. Each script fires when the player performs its trigger action.
Trigger verbs: ${VERBS.join(', ')}. Target = an object id or character id (for "go": a region id). For "give", "item" = the object id given.
Effects (in order): narrate{text} · set_flag{flag} · give_item{object} (into player's inventory) · remove_object{object} · reveal_object{object} (un-hide) · move_character{character, region} · end_story{text}.
"requires" lists flags set by earlier scripts, so scripts form the story's sequence. The last event's script should end_story.
Use only ids that exist below. Write narration in second person for the player.
EVENTS: ${json(input.events)}
${worldBrief(input)}

STORY:
${input.story}`,
  });
  const scripts = validateScripts(out.scripts, input).map((s, i) => ({ ...s, id: `s${i + 1}` }));
  if (!scripts.length) fail('No valid scripts could be composed.');
  return { scripts };
}

// [model assign]  r1 + r7 + r3* + r13* → r13_2*
export async function assignScripts({ story, scripts, characters, map, regionLabels, placementRegions }) {
  const schema = { type: 'object', properties: { assignments: { type: 'array', items: { type: 'object', properties: { scriptId: { type: 'string' }, npc: { type: ['string', 'null'] }, region: { type: ['string', 'null'] } }, required: ['scriptId', 'npc', 'region'] } } }, required: ['assignments'] };
  const out = await callModel({
    label: 'assignScripts', system: SYSTEM, schema,
    prompt: `For each script, assign the non-player character who voices its narration (character id, or null for the narrator) and the region where it takes place (region id or null).
SCRIPTS: ${json(scripts.map((s) => ({ id: s.id, title: s.title, trigger: s.trigger, effects: s.effects })))}
CHARACTERS (with region): ${json(charBrief(characters).map((c) => ({ ...c, region: placementRegions[c.id] })))}
REGIONS: ${json(regionBrief(map, regionLabels))}

STORY:
${story}`,
  });
  const cids = characters.filter((c) => !c.isPlayer).map((c) => c.id), rids = map.regions.map((r) => r.id);
  return {
    scripts: scripts.map((s) => {
      const a = (out.assignments || []).find((x) => x.scriptId === s.id) || {};
      return { ...s, npc: cids.includes(a.npc) ? a.npc : null, region: rids.includes(a.region) ? a.region : null };
    }),
  };
}

/* ===================== Process 4 ===================== */

const stateBrief = (spec, state, where) => `PLAYER: ${spec.characters.find((c) => c.id === spec.playerId)?.name} in ${where}
INVENTORY: ${json(state.inventory.map((id) => spec.objects.find((o) => o.id === id)?.name))}
FLAGS: ${json(state.flags)}
RECENT LOG: ${json(state.log.slice(-8).map((l) => l.text))}`;

// [model generate]~  r1 + r14 + r15 + r16 → r17*
export async function suggestActions({ story, spec, state, where, available }) {
  const schema = { type: 'object', properties: { suggestions: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, label: { type: 'string' } }, required: ['index', 'label'] } } }, required: ['suggestions'] };
  const out = await callModel({
    label: 'suggestActions', system: SYSTEM, schema,
    prompt: `Suggest the 3 to 4 most interesting next actions for the player, picking from the AVAILABLE list by index. Prefer actions that advance the story. Give each a short evocative button label (max 8 words).
AVAILABLE: ${json(available.map((a, i) => ({ index: i, action: a.label })))}
SCRIPTED STORY BEATS: ${json(spec.scripts.map((s) => ({ title: s.title, requires: s.requires, done: state.fired.includes(s.id) })))}
${stateBrief(spec, state, where)}

STORY:
${story}`,
  });
  const seen = new Set();
  const suggestions = (out.suggestions || [])
    .filter((s) => Number.isInteger(s.index) && available[s.index] && !seen.has(s.index) && seen.add(s.index))
    .slice(0, 4)
    .map((s) => ({ ...available[s.index], label: str(s.label, 60) || available[s.index].label }));
  return { suggestions };
}

/* ===================== Process 5 ===================== */

// [model generate]~  r14 + r15 + r21 → r22
export async function characterReply({ spec, state, characterId, utterance, where }) {
  const ch = spec.characters.find((c) => c.id === characterId) || fail('Unknown character.');
  if (ch.id === spec.playerId) fail('Pick another character to talk to.');
  const schema = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] };
  const out = await callModel({
    label: 'characterReply', system: SYSTEM, schema,
    prompt: `You are ${ch.name} in the game "${spec.title}". Reply in character, in 1 to 3 sentences, to what the player said. Do not narrate actions or change the world; only speak.
YOU: ${json({ description: ch.description, persona: ch.persona, trait: ch.trait })}
${stateBrief(spec, state, where)}
THE PLAYER SAYS: "${utterance}"`,
  });
  const reply = str(out.reply, 500);
  if (!reply) fail('Empty reply.');
  return { reply };
}

/* ===================== Process 6 ===================== */

// [model generate]~  r14 + r15 + r23 (+ the action that was evaluated) → r24
export async function improviseNarration({ spec, state, verdict, actionLabel, where }) {
  const schema = { type: 'object', properties: { narration: { type: 'string' } }, required: ['narration'] };
  const out = await callModel({
    label: 'improviseNarration', system: SYSTEM, schema,
    prompt: `The player of "${spec.title}" tried: "${actionLabel}". The engine's verdict: ${verdict} (${verdict === 'invalid' ? 'not possible right now' : 'allowed but nothing scripted happens'}).
Narrate in 1 to 2 second-person sentences what happens, consistent with the world. Nothing in the world may change (no items gained, nobody moves). If it is not possible, explain why in-world and hint at something useful.
${stateBrief(spec, state, where)}
CHARACTERS: ${json(spec.characters.map((c) => ({ name: c.name, description: c.description, persona: c.persona })))}`,
  });
  const narration = str(out.narration, 500);
  if (!narration) fail('Empty narration.');
  return { narration };
}
