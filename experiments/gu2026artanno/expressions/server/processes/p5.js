// Process 5: interaction_logs_2 + skill_library_1
//   -> [model_6 extract] mined_behaviors -> [model_7 generate]~ candidate_skills
//   -> [model_8 match] matching_skills -> [model_8 evaluate] skill_differences -> [model_8 modify]~ skill_library_2
import { callModel } from '../llm.js';

const SKILL_PROPS = { name: { type: 'string' }, description: { type: 'string' }, whenToUse: { type: 'string' }, procedure: { type: 'string' } };
const fmtSkills = (skills) => skills.map((s) => `- [${s.id}] ${s.name}: ${s.description} | When: ${s.whenToUse} | Procedure: ${s.procedure}`).join('\n');

export async function model6MineBehaviors(logs) {
  const out = await callModel({
    role: 'model_6',
    system: 'You are model_6, an analyst of annotation sessions. From interaction logs you extract recurring curator behaviours: how they corrected AI clusters and labels, what they agreed with, and the reasons they gave.',
    schema: { type: 'object', properties: { behaviors: { type: 'array', items: { type: 'object', properties: { behavior: { type: 'string' }, evidence: { type: 'string' }, logIds: { type: 'array', items: { type: 'string' } }, strength: { type: 'number' } }, required: ['behavior', 'evidence', 'logIds', 'strength'] } } }, required: ['behaviors'] },
    prompt: `Interaction logs (JSON lines):
${logs.map((l) => JSON.stringify(l)).join('\n')}

Extract 2-8 behaviours. Each: a general statement of what the curator does, the evidence, the log ids it rests on, and strength 0-1 (how consistently it appears).`,
  });
  const ids = new Set(logs.map((l) => l.id));
  return out.behaviors.map((b) => ({ ...b, logIds: b.logIds.filter((id) => ids.has(id)), strength: Math.max(0, Math.min(1, b.strength)) }));
}

export async function model7CandidateSkills(behaviors, library) {
  const out = await callModel({
    role: 'model_7',
    system: 'You are model_7, a skill writer. You turn observed curator behaviours into reusable skills for an AI that clusters and labels units in artworks. A skill has a name, a description, when to use it, and a concrete procedure the AI can follow.',
    schema: { type: 'object', properties: { skills: { type: 'array', items: { type: 'object', properties: SKILL_PROPS, required: Object.keys(SKILL_PROPS) } } }, required: ['skills'] },
    prompt: `Observed behaviours:
${behaviors.map((b, i) => `${i + 1}. ${b.behavior} (strength ${b.strength}) — evidence: ${b.evidence}`).join('\n')}

Existing skill library (for style; do not just copy):
${fmtSkills(library)}

Write 1-5 candidate skills that would make the AI reproduce these behaviours next time.`,
  });
  return out.skills.map((s, i) => ({ id: `cand-${i + 1}`, ...s }));
}

export async function model8Match(candidates, library) {
  const ids = new Set(library.map((s) => s.id));
  const out = await callModel({
    role: 'model_8',
    system: 'You are model_8, the curator of a skill library. You keep the library small, non-redundant and accurate.',
    schema: { type: 'object', properties: { matches: { type: 'array', items: { type: 'object', properties: { candidateId: { type: 'string' }, skillId: { type: 'string' }, similarity: { type: 'number' } }, required: ['candidateId', 'skillId', 'similarity'] } } }, required: ['matches'] },
    prompt: `Candidate skills:
${candidates.map((c) => `- [${c.id}] ${c.name}: ${c.description} | ${c.procedure}`).join('\n')}

Library:
${fmtSkills(library)}

For each candidate, give the id of the most similar existing skill and a similarity 0-1. Use an empty string for skillId if nothing in the library is related.`,
  });
  return candidates.map((c) => {
    const m = out.matches.find((x) => x.candidateId === c.id);
    return { candidateId: c.id, skillId: m && ids.has(m.skillId) ? m.skillId : null, similarity: m ? Math.max(0, Math.min(1, m.similarity)) : 0 };
  });
}

export async function model8Compare(candidates, matches, library) {
  const out = await callModel({
    role: 'model_8',
    system: 'You are model_8, the curator of a skill library. You keep the library small, non-redundant and accurate.',
    schema: { type: 'object', properties: { differences: { type: 'array', items: { type: 'object', properties: { candidateId: { type: 'string' }, relation: { type: 'string', enum: ['new', 'refines', 'duplicate', 'conflicts'] }, difference: { type: 'string' } }, required: ['candidateId', 'relation', 'difference'] } } }, required: ['differences'] },
    prompt: `Pairs of candidate skill and matching library skill:
${matches.map((m) => {
    const c = candidates.find((x) => x.id === m.candidateId);
    const s = library.find((x) => x.id === m.skillId);
    return `- candidate [${c.id}] ${c.name}: ${c.description} | ${c.procedure}\n  match: ${s ? `[${s.id}] ${s.name}: ${s.description} | ${s.procedure}` : '(none)'} (similarity ${m.similarity})`;
  }).join('\n')}

For each candidate, classify its relation to the match (new / refines / duplicate / conflicts) and state the concrete difference.`,
  });
  return matches.map((m) => {
    const d = out.differences.find((x) => x.candidateId === m.candidateId);
    return { candidateId: m.candidateId, skillId: m.skillId, relation: d?.relation || (m.skillId ? 'refines' : 'new'), difference: d?.difference || '' };
  });
}

export async function model8UpdateLibrary(candidates, differences, library) {
  const out = await callModel({
    role: 'model_8',
    system: 'You are model_8, the curator of a skill library. You keep the library small, non-redundant and accurate.',
    schema: { type: 'object', properties: { skills: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, ...SKILL_PROPS, change: { type: 'string', enum: ['unchanged', 'updated', 'added'] } }, required: ['id', ...Object.keys(SKILL_PROPS), 'change'] } } }, required: ['skills'] },
    validate: (o) => {
      const ids = o.skills.map((s) => s.id);
      if (new Set(ids).size !== ids.length) return 'skill ids must be unique';
      const kept = new Set(ids);
      const dropped = library.filter((s) => !kept.has(s.id));
      return dropped.length > library.length / 2 ? 'do not drop more than half of the existing skills' : null;
    },
    prompt: `Current library:
${fmtSkills(library)}

Candidate skills and how they differ:
${differences.map((d) => { const c = candidates.find((x) => x.id === d.candidateId); return `- ${c.name}: ${c.description} | When: ${c.whenToUse} | Procedure: ${c.procedure}\n  relation to ${d.skillId || 'nothing'}: ${d.relation} — ${d.difference}`; }).join('\n')}

Produce the updated library: add "new" candidates (give them a new kebab-case id starting with "skill-"), merge "refines" into the matched skill (keep its id), ignore "duplicate", and for "conflicts" rewrite the existing skill so it states when each variant applies. Mark each skill unchanged / updated / added.`,
  });
  const prev = new Map(library.map((s) => [s.id, s]));
  return out.skills.map((s) => ({
    id: s.id, name: s.name, description: s.description, whenToUse: s.whenToUse, procedure: s.procedure,
    origin: s.change === 'unchanged' && prev.has(s.id) ? prev.get(s.id).origin : 'learned', change: prev.has(s.id) ? s.change : 'added',
  }));
}
