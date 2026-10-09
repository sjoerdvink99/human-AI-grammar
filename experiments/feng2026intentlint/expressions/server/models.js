// Model steps. One prompt per operation, built only from the representations in the preceding state.
import { callModel } from './provider.js';
import { validateRule } from './tools.js';

const fmt = (o) => JSON.stringify(o, null, 2);
const rulesForPrompt = (rules) => rules.map(({ id, name, condition, guidance, severity }) => ({ id, name, condition, guidance, severity }));

/** model_1 match: context_1 + rules_1 + prompt_1 -> triggered_rules_1 */
export async function matchRules({ context, rules, prompt }) {
  if (!rules.length) return [];
  const system = `You are a prompt-linting rule matcher for a data-science notebook assistant.
Given a user's natural-language prompt for code generation, the notebook context, and a list of rules,
decide which rules apply. A rule applies when its "condition" holds for this prompt in this notebook context.
Be precise: do not trigger a rule whose condition is not clearly met. Return only rule ids from the list.`;
  const user = `NOTEBOOK CONTEXT:\n${fmt(context)}\n\nRULES:\n${fmt(rulesForPrompt(rules))}\n\nUSER PROMPT:\n${prompt}\n\nReturn the triggered rules with a one-sentence reason each.`;
  const schema = {
    type: 'object',
    properties: {
      triggered: {
        type: 'array',
        items: {
          type: 'object',
          properties: { rule_id: { type: 'string' }, reason: { type: 'string' } },
          required: ['rule_id', 'reason'],
        },
      },
    },
    required: ['triggered'],
  };
  const out = await callModel({ system, prompt: user, schema });
  const ids = new Set(rules.map((r) => r.id));
  const seen = new Set();
  // Validation: triggered rules must refer into the given rules, no duplicates.
  return (out.triggered || []).filter((t) => ids.has(t.rule_id) && !seen.has(t.rule_id) && seen.add(t.rule_id))
    .map((t) => ({ rule_id: t.rule_id, reason: String(t.reason || '') }));
}

/** model_2 modify~: context_1 + rules_1 + prompt_1 + triggered_rules_1 -> prompt_2 + lint_messages_1 */
export async function modifyPrompt({ context, rules, prompt, triggered }) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const applied = triggered.map((t) => ({ ...rulesForPrompt([byId.get(t.rule_id)])[0], reason: t.reason })).filter((r) => r.id);
  const system = `You are a prompt linter for a notebook code-generation assistant.
Rewrite the user's prompt so that it follows the triggered rules. Keep the user's intent and voice; change only what the
rules call for. The code generator will see ONLY the rewritten prompt, not the notebook, so include concrete notebook details
(variable names, column names, libraries already imported) wherever the rules ask for them. Never invent variables or
columns that are not in the notebook context.
For every triggered rule, write one lint message: what was wrong in the original prompt and what you changed.`;
  const user = `NOTEBOOK CONTEXT:\n${fmt(context)}\n\nTRIGGERED RULES:\n${fmt(applied)}\n\nORIGINAL PROMPT:\n${prompt}`;
  const schema = {
    type: 'object',
    properties: {
      revised_prompt: { type: 'string' },
      lint_messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rule_id: { type: 'string' },
            message: { type: 'string', description: 'What was missing or problematic in the original prompt' },
            change: { type: 'string', description: 'What was changed in the revised prompt' },
          },
          required: ['rule_id', 'message', 'change'],
        },
      },
    },
    required: ['revised_prompt', 'lint_messages'],
  };
  const out = await callModel({ system, prompt: user, schema });
  const revised = String(out.revised_prompt || '').trim();
  if (!revised) throw new Error('Model returned an empty revised prompt');
  const lint = (out.lint_messages || [])
    .filter((m) => byId.has(m.rule_id))
    .map((m) => ({ rule_id: m.rule_id, severity: byId.get(m.rule_id).severity, message: String(m.message), change: String(m.change || '') }));
  return { prompt: revised, lint_messages: lint };
}

/** model_4 generate~: prompt_2 -> code_1 */
export async function generateCode({ prompt }) {
  const system = `You write Python code for a Jupyter notebook cell. Return only the code for one cell, no Markdown fences.
Use short comments where helpful. Assume variables mentioned in the request already exist.`;
  const schema = { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] };
  const out = await callModel({ system, prompt: `REQUEST:\n${prompt}`, schema });
  const code = String(out.code || '').replace(/^```\w*\n?|```\s*$/g, '').trim();
  if (!code) throw new Error('Model returned no code');
  return code;
}

/** model_3 generate~: prompt_1 + context_1 + triggered_rules_1 + rules_1 -> rule_proposals_1 */
export async function proposeRules({ prompt, context, triggered, rules }) {
  const system = `You help a data scientist grow a personal set of prompt-linting rules for a notebook code assistant.
A rule has: name (short), condition (when the rule applies to a prompt, phrased so another model can check it),
guidance (how the prompt should be rewritten when it applies), severity ("info" or "warning").
Look at the user's prompt in its notebook context. Propose 1-3 NEW, reusable rules that would have made this prompt clearer
or more specific and that are not already covered by the existing rules. Rules must be general (apply to future prompts),
not specific to this one prompt. Include a one-sentence rationale per proposal.`;
  const user = `EXISTING RULES:\n${fmt(rulesForPrompt(rules))}\n\nRULES TRIGGERED BY THIS PROMPT:\n${fmt(triggered)}\n\nNOTEBOOK CONTEXT:\n${fmt(context)}\n\nUSER PROMPT:\n${prompt}`;
  const schema = {
    type: 'object',
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            condition: { type: 'string' },
            guidance: { type: 'string' },
            severity: { type: 'string', enum: ['info', 'warning'] },
            rationale: { type: 'string' },
          },
          required: ['name', 'condition', 'guidance', 'severity', 'rationale'],
        },
      },
    },
    required: ['proposals'],
  };
  const out = await callModel({ system, prompt: user, schema });
  const existing = new Set(rules.map((r) => r.name.trim().toLowerCase()));
  const proposals = [];
  for (const p of out.proposals || []) {
    try {
      const r = validateRule(p);
      if (existing.has(r.name.toLowerCase())) continue;
      proposals.push({ ...r, rationale: String(p.rationale || '') });
    } catch { /* drop invalid proposals */ }
  }
  return proposals;
}
