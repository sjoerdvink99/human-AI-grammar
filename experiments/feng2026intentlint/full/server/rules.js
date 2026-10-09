// tool_2: rule management and synchronization service.
// Owns the shared rule board (rules_n), persists it, and broadcasts changes to every client.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SEVERITIES = ['info', 'warning', 'error'];

/** Validate and normalise a rule-like object. Throws on invalid input. */
export function normalizeRule(r) {
  const title = String(r?.title ?? '').trim();
  const description = String(r?.description ?? '').trim();
  if (!title) throw new Error('rule title is required');
  if (!description) throw new Error('rule description is required');
  const severity = SEVERITIES.includes(r.severity) ? r.severity : 'warning';
  return { title: title.slice(0, 120), description: description.slice(0, 1000), severity };
}

export class RuleStore {
  constructor(file) {
    this.file = file;
    this.listeners = new Set();
    this.rules = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  }
  list() { return this.rules; }
  get(id) { return this.rules.find(r => r.id === id); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save(event) {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.rules, null, 2));
    }
    for (const fn of this.listeners) fn({ ...event, rules: this.rules });
  }

  /** tool_2 compose: accepted_rules_1 + rules_1 -> rules_2. Skips duplicates by title. */
  compose(accepted, author = 'analyst') {
    const existing = new Set(this.rules.map(r => r.title.toLowerCase()));
    const added = [];
    for (const raw of accepted) {
      const r = normalizeRule(raw);
      if (existing.has(r.title.toLowerCase())) continue;
      existing.add(r.title.toLowerCase());
      const rule = { id: randomUUID().slice(0, 8), ...r, author, origin: 'proposal', version: 1, updatedAt: new Date().toISOString() };
      this.rules.push(rule);
      added.push(rule);
    }
    if (added.length) this.save({ type: 'added', ids: added.map(r => r.id), author });
    return added;
  }

  /** Process 3: rules_2 -> rules_3 (edit description / severity / title). */
  update(id, patch, author = 'analyst') {
    const rule = this.get(id);
    if (!rule) throw new Error('unknown rule ' + id);
    const next = normalizeRule({ ...rule, ...patch });
    Object.assign(rule, next, { version: rule.version + 1, updatedAt: new Date().toISOString(), editedBy: author });
    this.save({ type: 'updated', ids: [id], author });
    return rule;
  }
}
