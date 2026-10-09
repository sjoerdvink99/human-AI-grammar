// Deterministic [tool …] steps.

export const METRICS = {
  sleep: { label: 'Sleep', unit: 'h', field: 'sleep_hours' },
  steps: { label: 'Steps', unit: 'steps', field: 'steps', hourly: 'steps_hourly' },
  heart_rate: { label: 'Heart rate', unit: 'bpm', field: 'resting_hr', hourly: 'hr_hourly' },
  mood: { label: 'Mood', unit: '/5', field: 'mood' },
};

/** P1 [tool select]: r1* -> r2_1. Picks the most recent day as the focus record. */
export function selectFocusRecord(records) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date))[0];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const STOP = new Set(['the', 'a', 'an', 'i', 'my', 'day', 'when', 'was', 'with', 'and', 'of', 'to', 'on', 'at', 'in', 'that', 'went', 'had', 'did', 'last', 'me', 'for', 'it', 'night', 'slept', 'sleep', 'worst', 'best', 'most', 'least', 'felt', 'mood', 'steps']);

// Superlative phrases → [field, direction]
const SUPERLATIVES = [
  [/(slept|sleep).*(least|worst|badly|poorly|little|short)|(least|worst|bad|poor|short).*(sleep|night)/, 'sleep_hours', 'min'],
  [/(slept|sleep).*(most|best|well|long)|(most|best|long|good).*(sleep|night)/, 'sleep_hours', 'max'],
  [/(most|many|lots).*(steps|walk|active)|(busiest|most active|walked a lot)/, 'steps', 'max'],
  [/(least|few|lazy).*(steps|walk|active)|(laziest|least active|stayed in)/, 'steps', 'min'],
  [/(best|happiest|great|good) (mood|day)|happiest|felt great/, 'mood', 'max'],
  [/(worst|saddest|bad|low) (mood|day)|saddest|felt (bad|down|low)/, 'mood', 'min'],
  [/(stress|stressful|heart racing)/, 'resting_hr', 'max'],
];

/**
 * P3 [tool select]: r1* + r8 -> r2_2. Finds the day record that best matches a free-text description.
 * Scoring: explicit dates and weekdays, keyword overlap with events/places/weather, superlatives on metrics.
 * @returns {{record: object, score: number, reasons: string[]}}
 */
export function searchRecord(records, query, today = selectFocusRecord(records)?.date) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) throw new Error('Describe the day you want to reflect on.');
  const scored = records.map((r) => ({ record: r, score: 0, reasons: [] }));
  const add = (s, pts, why) => { s.score += pts; if (!s.reasons.includes(why)) s.reasons.push(why); };

  // explicit ISO date
  const iso = q.match(/\d{4}-\d{2}-\d{2}/);
  // "nov 3" / "3 nov"
  const md = q.match(new RegExp(`(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})`));
  const todayDate = today ? new Date(today + 'T00:00:00Z') : null;
  const rel = /yesterday/.test(q) ? 1 : /today/.test(q) ? 0 : null;

  for (const s of scored) {
    const r = s.record;
    const d = new Date(r.date + 'T00:00:00Z');
    if (iso && r.date === iso[0]) add(s, 100, `date ${r.date}`);
    if (md) {
      const mon = MONTHS.indexOf((md[1] || md[4]).slice(0, 3));
      const day = Number(md[2] || md[3]);
      if (d.getUTCMonth() === mon && d.getUTCDate() === day) add(s, 100, `date ${r.date}`);
    }
    if (rel !== null && todayDate && todayDate.getTime() - d.getTime() === rel * 86400000) add(s, 100, rel ? 'yesterday' : 'today');
    WEEKDAYS.forEach((w) => {
      if (q.includes(w) && r.weekday.toLowerCase() === w) add(s, 8, r.weekday);
    });
    if (/weekend/.test(q) && (r.weekday === 'Saturday' || r.weekday === 'Sunday')) add(s, 5, 'weekend');

    const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
    const haystacks = [...r.events, ...r.places, r.weather].map((h) => h.toLowerCase());
    for (const w of words) {
      const stem = w.replace(/(ing|ed|s)$/, '');
      if (stem.length < 3) continue;
      const hit = haystacks.find((h) => h.includes(stem));
      if (hit) add(s, 10, `"${hit}"`);
    }
  }

  for (const [re, field, dir] of SUPERLATIVES) {
    if (!re.test(q)) continue;
    const values = records.map((r) => r[field]);
    const best = dir === 'max' ? Math.max(...values) : Math.min(...values);
    const range = Math.max(...values) - Math.min(...values) || 1;
    for (const s of scored) {
      const closeness = 1 - Math.abs(s.record[field] - best) / range;
      if (closeness > 0) s.score += 30 * closeness;
      if (s.record[field] === best) add(s, 0, `${dir === 'max' ? 'highest' : 'lowest'} ${field.replace('_', ' ')}`);
    }
  }

  scored.sort((a, b) => b.score - a.score || b.record.date.localeCompare(a.record.date));
  const top = scored[0];
  if (!top || top.score <= 0) throw new Error('No day matches that description. Try an event, place, weekday or date.');
  return { record: top.record, score: Math.round(top.score), reasons: top.reasons };
}

/** P4 [tool select]: r1* + r9 -> r10*. One metric record per day. */
export function metricRecords(records, metric) {
  const m = METRICS[metric];
  if (!m) throw new Error(`Unknown metric "${metric}"`);
  return records.map((r) => ({ id: r.id, date: r.date, weekday: r.weekday, metric, value: r[m.field], unit: m.unit }));
}

/**
 * P4 [tool translate]: r11 -> r12. Converts a selected metric record into a chart spec
 * (hourly series for steps/heart rate; day-vs-all-days for sleep/mood).
 */
export function chartSpec(records, metric, id) {
  const m = METRICS[metric];
  if (!m) throw new Error(`Unknown metric "${metric}"`);
  const r = records.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown record "${id}"`);
  if (m.hourly) {
    return {
      kind: metric === 'steps' ? 'bars' : 'line',
      title: `${m.label} by hour — ${r.weekday} ${r.date}`,
      unit: m.unit,
      xLabel: 'Hour of day',
      points: r[m.hourly].map((v, h) => ({ x: String(h), y: v })),
      summary: `${m.field === 'steps' ? 'Total' : 'Resting'}: ${r[m.field]} ${m.unit}`,
    };
  }
  return {
    kind: 'bars',
    title: `${m.label} — ${r.weekday} ${r.date} compared with all days`,
    unit: m.unit,
    xLabel: 'Day',
    highlight: r.date.slice(5),
    points: records.map((x) => ({ x: x.date.slice(5), y: x[m.field] })),
    summary: `${r[m.field]} ${m.unit} (average ${(records.reduce((a, x) => a + x[m.field], 0) / records.length).toFixed(1)})`,
  };
}
