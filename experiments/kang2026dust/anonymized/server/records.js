// r1 (records): the collection of personal-data day records.
import { readFileSync } from 'node:fs';

/** @typedef {{id:string,date:string,weekday:string,sleep_hours:number,steps:number,steps_hourly:number[],resting_hr:number,hr_hourly:number[],mood:number,events:string[],places:string[],weather:string}} DayRecord */

let cache;
/** @returns {DayRecord[]} */
export function loadRecords() {
  if (!cache) cache = JSON.parse(readFileSync(new URL('../data/records.json', import.meta.url), 'utf8'));
  return cache;
}

/** Compact text form of a record for model context (drops hourly arrays to summaries). */
export function describeRecord(r) {
  const peakStepHour = r.steps_hourly.indexOf(Math.max(...r.steps_hourly));
  const peakHrHour = r.hr_hourly.indexOf(Math.max(...r.hr_hourly));
  return [
    `Date: ${r.weekday} ${r.date}`,
    `Sleep: ${r.sleep_hours} h`,
    `Steps: ${r.steps} (most active around ${peakStepHour}:00)`,
    `Resting heart rate: ${r.resting_hr} bpm (peak ${Math.max(...r.hr_hourly)} bpm around ${peakHrHour}:00)`,
    `Self-reported mood: ${r.mood}/5`,
    `Calendar events: ${r.events.length ? r.events.join('; ') : 'none'}`,
    `Places visited: ${r.places.join(', ')}`,
    `Weather: ${r.weather}`,
  ].join('\n');
}

/** Short overview of the whole collection, so prompts can compare the focus day to the norm. */
export function describeBaseline(records) {
  const avg = (k) => records.reduce((a, r) => a + r[k], 0) / records.length;
  return `Across ${records.length} days the person averages ${avg('sleep_hours').toFixed(1)} h sleep, ${Math.round(avg('steps'))} steps, resting HR ${Math.round(avg('resting_hr'))} bpm, mood ${avg('mood').toFixed(1)}/5.`;
}
