// JSON-file persistence for highlights (the highlights_1 collection) and entries (response/remix per highlight).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createStore(file, seedFile) {
  let data;
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const seed = seedFile && fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile, 'utf8')) : [];
    data = {
      highlights: seed.map((h) => ({ ...h, addedAt: new Date().toISOString(), lastSurfacedAt: null, surfacedCount: 0 })),
      entries: [],
    };
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };
  save();

  return {
    highlights: () => data.highlights,
    highlight: (id) => data.highlights.find((h) => h.id === id),
    markSurfaced(id) {
      const h = data.highlights.find((x) => x.id === id);
      if (h) {
        h.lastSurfacedAt = new Date().toISOString();
        h.surfacedCount = (h.surfacedCount || 0) + 1;
        save();
      }
      return h;
    },
    entries: () => data.entries,
    entry: (id) => data.entries.find((e) => e.id === id),
    entriesFor: (highlightId) => data.entries.filter((e) => e.highlightId === highlightId),
    addEntry(e) {
      const entry = { id: crypto.randomUUID(), alternatives: [], createdAt: new Date().toISOString(), ...e };
      data.entries.push(entry);
      save();
      return entry;
    },
    addAlternative(entryId, alt) {
      const e = data.entries.find((x) => x.id === entryId);
      if (!e) return null;
      e.alternatives.push({ ...alt, createdAt: new Date().toISOString() });
      save();
      return e;
    },
  };
}
