// Process 5 — Distill and manage reusable skills.
// model_6 extract (Behavior Mining) → model_7 generate~ (Skill Generation) → model_8 match / evaluate / modify~ (Skill Management)
import { z } from 'zod';
import { callModelJson } from './llm.js';
import { formatLogs } from './logs.js';

const SkillBody = z.object({ name: z.string().min(3), applies_to: z.string(), procedure: z.array(z.string()).min(1), cues: z.array(z.string()).default([]) });
const fmtSkill = (s, i) => `${s.id ?? `cand-${i}`}: ${s.name} — applies to: ${s.applies_to}\n  procedure: ${s.procedure.join(' → ')}\n  cues: ${(s.cues || []).join(', ')}`;
const fmtLibrary = (skills) => skills.map((s) => fmtSkill(s)).join('\n');

/** model_6 extract */
export async function mineBehaviors(logs, library) {
  const v = await callModelJson({
    system: 'You are the Behavior Mining Agent. From an annotator\'s interaction log you extract decisions and procedures that would help in later annotation tasks: how they verified meanings, what evidence convinced them, which recommendations they corrected and why.',
    prompt: `Interaction log:\n${formatLogs(logs)}\n\nExisting skill library (for reference, do not repeat what is already covered):\n${fmtLibrary(library)}\n\nExtract 1–6 useful behaviours.\nJSON: {"behaviors":[{"behavior":"...","procedure":["step"],"evidence":"log #n ..."}]}`,
    schema: z.object({ behaviors: z.array(z.object({ behavior: z.string(), procedure: z.array(z.string()), evidence: z.string() })) }),
  });
  return v.behaviors;
}

/** model_7 generate~ */
export async function generateSkills(behaviors, library) {
  const v = await callModelJson({
    system: 'You are the Skill Generation Agent. You turn mined annotator behaviours into reusable, task-independent annotation skills: a name, when the skill applies, a short step-by-step procedure, and visual or contextual cues that trigger it.',
    prompt: `Mined behaviours:\n${behaviors.map((b, i) => `${i}. ${b.behavior} — ${b.procedure.join(' → ')} (${b.evidence})`).join('\n')}\n\nExisting skill library:\n${fmtLibrary(library)}\n\nWrite 1–4 candidate skills.\nJSON: {"skills":[{"name":"...","applies_to":"...","procedure":["..."],"cues":["..."]}]}`,
    schema: z.object({ skills: z.array(SkillBody).min(1) }),
  });
  return v.skills;
}

/** model_8 match */
export async function matchSkills(candidates, library) {
  const ids = library.map((s) => s.id);
  const v = await callModelJson({
    system: 'You are the Skill Management Agent. You align new candidate skills with existing skill modules.',
    prompt: `Candidate skills:\n${candidates.map(fmtSkill).join('\n')}\n\nExisting skills:\n${fmtLibrary(library)}\n\nFor each candidate list the existing skills that overlap with it in purpose or procedure (possibly none).\nJSON: {"matches":[{"candidate":"cand-0","skill_ids":["..."]}]}`,
    schema: z.object({ matches: z.array(z.object({ candidate: z.string(), skill_ids: z.array(z.string()) })) }),
    check: (x) => { const bad = x.matches.flatMap((m) => m.skill_ids).filter((id) => !ids.includes(id)); return bad.length ? `unknown skill ids ${bad.join(', ')}` : null; },
  });
  return candidates.map((_, i) => ({ candidate: `cand-${i}`, skillIds: v.matches.find((m) => m.candidate === `cand-${i}`)?.skill_ids || [] }));
}

/** model_8 evaluate */
export async function diffSkills(candidates, matches, library) {
  const v = await callModelJson({
    system: 'You are the Skill Management Agent. You judge how each new candidate skill differs from the existing skills it overlaps with, and decide whether it should be added as new, merged into an existing skill, branched as a specialised variant, or skipped as redundant.',
    prompt: `Candidates and their overlapping existing skills:\n${candidates.map((c, i) => `${fmtSkill(c, i)}\n  overlaps: ${matches[i].skillIds.map((id) => fmtSkill(library.find((s) => s.id === id))).join('\n    ') || 'none'}`).join('\n\n')}\n\nJSON: {"differences":[{"candidate":"cand-0","action":"add|merge|branch|skip","target_id":"<existing id or null>","difference":"..."}]}`,
    schema: z.object({ differences: z.array(z.object({ candidate: z.string(), action: z.enum(['add', 'merge', 'branch', 'skip']), target_id: z.string().nullable().optional(), difference: z.string() })) }),
    check: (x) => {
      for (const d of x.differences) if ((d.action === 'merge' || d.action === 'branch') && !library.find((s) => s.id === d.target_id)) return `${d.candidate}: ${d.action} needs a valid target_id`;
      return null;
    },
  });
  return v.differences;
}

/** model_8 modify~ → skill_library_2 (model writes the merged/branched/new skill text; code applies it). */
export async function updateLibrary(candidates, differences, library, sourceTask) {
  const actionable = differences.filter((d) => d.action !== 'skip');
  if (!actionable.length) return { skills: library, changes: [] };
  const v = await callModelJson({
    system: 'You are the Skill Management Agent. You write the final text of skill modules after aligning new and existing skills. Merged skills must keep what was useful in the original and integrate the new steps; branched skills specialise the parent for a narrower situation.',
    prompt: `Decisions:\n${actionable.map((d) => { const i = Number(d.candidate.split('-')[1]); const t = library.find((s) => s.id === d.target_id); return `${d.candidate} → ${d.action}${t ? ` ${t.id}` : ''}: ${d.difference}\n  candidate: ${fmtSkill(candidates[i], i)}${t ? `\n  existing: ${fmtSkill(t)}` : ''}`; }).join('\n\n')}\n\nWrite the resulting skill for each decision.\nJSON: {"updates":[{"candidate":"cand-0","skill":{"name":"...","applies_to":"...","procedure":["..."],"cues":["..."]}}]}`,
    schema: z.object({ updates: z.array(z.object({ candidate: z.string(), skill: SkillBody })) }),
  });
  const skills = library.map((s) => ({ ...s }));
  const changes = [];
  for (const d of actionable) {
    const u = v.updates.find((x) => x.candidate === d.candidate);
    if (!u) continue;
    if (d.action === 'merge') {
      const i = skills.findIndex((s) => s.id === d.target_id);
      skills[i] = { ...skills[i], ...u.skill, version: skills[i].version + 1, origin: sourceTask };
      changes.push({ action: 'merge', id: skills[i].id, difference: d.difference });
    } else {
      const id = `sk-${Math.random().toString(36).slice(2, 7)}`;
      skills.push({ id, ...u.skill, version: 1, parent: d.action === 'branch' ? d.target_id : null, origin: sourceTask });
      changes.push({ action: d.action, id, parent: d.target_id || null, difference: d.difference });
    }
  }
  return { skills, changes };
}
