// Model steps of processes 1 and 2. Each operation has its own prompt and is built only
// from the representations present in the state that precedes it in the design.
import { callModel } from './llm.js';
import { SEVERITIES, normalizeRule } from './rules.js';

const j = x => JSON.stringify(x, null, 2);
const rulesForModel = rules => rules.map(r => ({ id: r.id, title: r.title, description: r.description, severity: r.severity }));

// ---------- model_1 match: context_1 + rules_1 + prompt_1 -> triggered_rules_1 ----------
export function validateTriggered(rules) {
  const ids = new Set(rules.map(r => r.id));
  return out => {
    if (!Array.isArray(out?.triggered)) throw new Error('triggered must be an array');
    const seen = new Set();
    return out.triggered
      .filter(t => t && ids.has(t.ruleId) && !seen.has(t.ruleId) && seen.add(t.ruleId))
      .map(t => ({ ruleId: t.ruleId, reason: String(t.reason || '').slice(0, 400) }));
  };
}

export async function matchRules({ prompt, context, rules }) {
  if (!rules.length) return [];
  return callModel({
    role: 'model_1 match (rule checker)',
    system: 'You are a rule-checking agent inside a shared data-analysis notebook. A team keeps shared collaboration rules. Decide which rules apply to the analyst\'s prompt, given the notebook context. A rule applies if following the prompt as written could violate it, or if the rule constrains how the requested code should be written. Do not include rules that are unrelated to the request.',
    prompt: `NOTEBOOK CONTEXT:\n${j(context)}\n\nSHARED RULES:\n${j(rulesForModel(rules))}\n\nANALYST PROMPT:\n${prompt}\n\nReturn {"triggered":[{"ruleId":"<id from SHARED RULES>","reason":"<one sentence why it applies>"}]}. Use an empty array if none apply.`,
    validate: validateTriggered(rules),
  });
}

// ---------- model_2 modify: context_1 + rules_1 + prompt_1 + triggered_rules_1 -> prompt_2 + lint_messages_1 ----------
export function validateLint(triggered, rules) {
  const sev = new Map(rules.map(r => [r.id, r.severity]));
  const triggeredIds = new Set(triggered.map(t => t.ruleId));
  return out => {
    const revisedPrompt = String(out?.revisedPrompt ?? '').trim();
    if (!revisedPrompt) throw new Error('revisedPrompt missing');
    if (!Array.isArray(out.messages)) throw new Error('messages must be an array');
    const messages = out.messages
      .filter(m => m && triggeredIds.has(m.ruleId) && m.message)
      .map(m => ({
        ruleId: m.ruleId,
        severity: sev.get(m.ruleId) || 'warning', // severity comes from the shared rule, not the model
        message: String(m.message).slice(0, 300),
        explanation: String(m.explanation || '').slice(0, 800),
        quote: String(m.quote || '').slice(0, 200),
      }));
    return { revisedPrompt, messages };
  };
}

export async function lintPrompt({ prompt, context, rules, triggered }) {
  if (!triggered.length) return { revisedPrompt: prompt, messages: [] };
  const byId = new Map(rules.map(r => [r.id, r]));
  const triggeredFull = triggered.map(t => ({ ...rulesForModel([byId.get(t.ruleId)])[0], whyItApplies: t.reason }));
  return callModel({
    role: 'model_2 modify (prompt linter)',
    system: 'You are a prompt linter for an AI coding assistant in a shared data-analysis notebook. Rewrite the analyst\'s prompt so that the code generated from it follows the team\'s triggered rules and uses the notebook\'s real variable, dataframe and column names. Keep the analyst\'s intent and voice; make the minimal additions needed (explicit assumptions, names, constraints). For each triggered rule that the original prompt conflicts with or leaves unaddressed, write one lint message.',
    prompt: `NOTEBOOK CONTEXT:\n${j(context)}\n\nALL SHARED RULES:\n${j(rulesForModel(rules))}\n\nTRIGGERED RULES:\n${j(triggeredFull)}\n\nORIGINAL PROMPT:\n${prompt}\n\nReturn {"revisedPrompt":"<full revised prompt>","messages":[{"ruleId":"<triggered rule id>","quote":"<the part of the original prompt concerned, or empty>","message":"<short warning>","explanation":"<why this matters and what the revision changed>"}]}`,
    validate: validateLint(triggered, rules),
  });
}

// ---------- model_4 generate: prompt_2 -> code_1 ----------
export async function generateCode({ prompt }) {
  return callModel({
    role: 'model_4 generate (coding assistant)',
    system: 'You are an AI coding assistant in a Python data-analysis notebook. Write the code for one new notebook cell that fulfils the request. Assume variables named in the request already exist in the notebook. Use comments sparingly.',
    prompt: `REQUEST:\n${prompt}\n\nReturn {"code":"<python source for one cell>","summary":"<one sentence>"}`,
    validate: out => {
      const code = String(out?.code ?? '').replace(/^```\w*\n?|```$/g, '').trim();
      if (!code) throw new Error('empty code');
      return { code, summary: String(out.summary || '') };
    },
  });
}

// ---------- model_3 generate: prompt_1 + context_1 + triggered_rules_1 + rules_1 -> rule_proposals_1 ----------
export function validateProposals(rules) {
  const existing = new Set(rules.map(r => r.title.toLowerCase()));
  return out => {
    if (!Array.isArray(out?.proposals)) throw new Error('proposals must be an array');
    const res = [];
    for (const p of out.proposals) {
      try {
        const r = normalizeRule(p);
        if (existing.has(r.title.toLowerCase())) continue;
        res.push({ ...r, rationale: String(p.rationale || '').slice(0, 500), basedOn: Array.isArray(p.basedOn) ? p.basedOn.map(String) : [] });
      } catch { /* drop invalid proposals */ }
    }
    return res.slice(0, 4);
  };
}

export async function proposeRules({ prompt, context, rules, triggered }) {
  return callModel({
    role: 'model_3 generate (rule proposer)',
    system: `You help a team of data analysts maintain shared collaboration rules that are checked whenever someone prompts the AI coding assistant. Based on this interaction, propose new rules that are MORE SPECIFIC than the existing ones: tied to this notebook's datasets, columns, variables, conventions or analytic decisions, so teammates make consistent choices. Do not duplicate existing rules. Propose 1 to 3 rules. Severity is one of ${SEVERITIES.join(', ')}.`,
    prompt: `ANALYST PROMPT:\n${prompt}\n\nNOTEBOOK CONTEXT:\n${j(context)}\n\nTRIGGERED RULES:\n${j(triggered)}\n\nEXISTING SHARED RULES:\n${j(rulesForModel(rules))}\n\nReturn {"proposals":[{"title":"<short imperative title>","description":"<the rule, precise and checkable>","severity":"info|warning|error","rationale":"<why, referring to the prompt/context>","basedOn":["<existing rule ids it refines, if any>"]}]}`,
    validate: validateProposals(rules),
  });
}
