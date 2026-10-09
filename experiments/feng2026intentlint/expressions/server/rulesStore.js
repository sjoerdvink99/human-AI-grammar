// Persistent, versioned rule set (rules_1 -> rules_2 -> rules_3 ...) and the active-rule selection.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RULES } from './sample.js';
import { validateRule } from './tools.js';

export class RulesStore {
  constructor(file) {
    this.file = file;
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      this.data = { versions: [], active: DEFAULT_RULES.map((r) => r.id) };
      this.data.versions.push({ version: 1, source: 'default rules', at: new Date().toISOString(), rules: DEFAULT_RULES });
      this.save();
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
  current() { return this.data.versions[this.data.versions.length - 1]; }
  state() {
    const cur = this.current();
    return {
      version: cur.version,
      rules: cur.rules,
      active: this.data.active.filter((id) => cur.rules.some((r) => r.id === id)),
      history: this.data.versions.map(({ version, source, at, rules }) => ({ version, source, at, count: rules.length })),
    };
  }
  activeRules() {
    const s = this.state();
    return s.rules.filter((r) => s.active.includes(r.id));
  }
  /** Adds a new version. `newIds` become active by default. */
  commit(rules, source, newIds = []) {
    const clean = rules.map((r) => ({ id: String(r.id), ...validateRule(r) }));
    const ids = new Set(clean.map((r) => r.id));
    if (ids.size !== clean.length) throw new Error('Duplicate rule ids');
    this.data.versions.push({ version: this.current().version + 1, source, at: new Date().toISOString(), rules: clean });
    this.data.active = [...new Set([...this.data.active, ...newIds])].filter((id) => ids.has(id));
    this.save();
    return this.state();
  }
  setActive(ids) {
    const valid = new Set(this.current().rules.map((r) => r.id));
    this.data.active = [...new Set(ids)].filter((id) => valid.has(id));
    this.save();
    return this.state();
  }
  revert(version) {
    const v = this.data.versions.find((x) => x.version === Number(version));
    if (!v) throw new Error('No such version');
    return this.commit(v.rules, `revert to v${v.version}`);
  }
}
