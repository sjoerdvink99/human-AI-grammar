// Generates a deterministic sample of r1 (records): 42 days of personal data.
import { writeFileSync } from 'node:fs';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];

const EVENTS = [
  'Team standup', 'Dentist appointment', 'Lunch with Maya', 'Project deadline', 'Yoga class',
  'Call with parents', 'Grocery shopping', 'Book club', 'Job interview', 'Birthday dinner',
  'Movie night', 'Piano lesson', 'Doctor check-up', 'Board game night',
  'Volunteering at food bank', 'Conference talk', 'Coffee with Sam', 'Moving boxes', 'Concert',
];
const PLACES = ['Home', 'Office', 'Park', 'Gym', 'Café Lune', 'Riverside trail', 'Library', 'City centre', 'Mountain trail', 'Beach'];
const WEATHER = ['sunny', 'cloudy', 'rainy', 'windy', 'snowy', 'foggy'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const end = new Date('2026-11-24T00:00:00Z');
const records = [];
for (let i = 41; i >= 0; i--) {
  const d = new Date(end.getTime() - i * 86400000);
  const date = d.toISOString().slice(0, 10);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const active = rand() < (weekend ? 0.5 : 0.2);
  const steps_hourly = Array.from({ length: 24 }, (_, h) => {
    if (h < 6 || h > 22) return 0;
    let base = 150 + rand() * 400;
    if (h === 8 || h === 18) base += 600 * rand();
    if (active && h >= 10 && h <= 14) base += 1500 + rand() * 1500;
    return Math.round(base);
  });
  const resting_hr = Math.round(56 + rand() * 10);
  const hr_hourly = Array.from({ length: 24 }, (_, h) => {
    const awake = h >= 7 && h <= 22;
    const exercise = active && h >= 10 && h <= 14 ? 40 * rand() : 0;
    return Math.round(resting_hr + (awake ? 12 + rand() * 15 : rand() * 4) + exercise);
  });
  const events = [];
  const nEvents = Math.floor(rand() * 3);
  for (let k = 0; k < nEvents; k++) { const e = pick(EVENTS); if (!events.includes(e)) events.push(e); }
  if (active) events.push(weekend ? 'Hiking trip' : 'Evening run');
  const places = ['Home'];
  if (!weekend) places.push('Office');
  if (active) places.push(pick(['Park', 'Riverside trail', 'Mountain trail', 'Gym']));
  if (rand() < 0.4) places.push(pick(PLACES));
  const sleep_hours = Math.round((5.5 + rand() * 3.2) * 10) / 10;
  const mood = Math.max(1, Math.min(5, Math.round(2.5 + rand() * 2 + (sleep_hours > 7 ? 0.6 : -0.4) + (active ? 0.5 : 0))));
  records.push({
    id: `day-${date}`,
    date,
    weekday: WEEKDAYS[d.getUTCDay()],
    sleep_hours,
    steps: steps_hourly.reduce((a, b) => a + b, 0),
    steps_hourly,
    resting_hr,
    hr_hourly,
    mood,
    events: [...new Set(events)],
    places: [...new Set(places)],
    weather: pick(WEATHER),
  });
}
writeFileSync(new URL('../data/records.json', import.meta.url), JSON.stringify(records, null, 2));
console.log(`wrote ${records.length} records`);
