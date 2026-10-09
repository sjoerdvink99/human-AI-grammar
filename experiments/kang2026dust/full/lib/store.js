// Persistence: one JSON file holding highlights and weekly entries.
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} Week
 * @property {string} week              ISO date of that week's Monday
 * @property {string} highlightId       highlight_1 / highlight_2
 * @property {string[]} keywords        keywords_1 / keywords_2
 * @property {string|null} interest     interest_1 that shaped these keywords
 * @property {string|null} response     response_1
 * @property {string|null} remix        remix_1
 * @property {string|null} alternativeRemix  alternative_remix_1
 * @property {boolean} retryUsed        retry_1 was spent
 * @property {string} createdAt
 */

const DEFAULT = () => ({ highlights: [], weeks: [], dayOffset: 0 });

export class Store {
  constructor(file) {
    this.file = file;
    this.data = DEFAULT();
    if (file && fs.existsSync(file)) this.data = { ...DEFAULT(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  highlight(id) { return this.data.highlights.find((h) => h.id === id) || null; }
  week(key) { return this.data.weeks.find((w) => w.week === key) || null; }
}
