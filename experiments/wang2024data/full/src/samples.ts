// Bundled sample tables. All values are synthetic (generated deterministically here).
import type { Row } from '../shared/types';

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const round1 = (x: number) => Math.round(x * 10) / 10;

function temperatures(): Row[] {
  const r = rng(7);
  const rows: Row[] = [];
  const start = Date.UTC(2023, 0, 1);
  for (let w = 0; w < 52; w++) {
    const d = new Date(start + w * 7 * 86400000).toISOString().slice(0, 10);
    const season = Math.sin(((w - 13) / 52) * 2 * Math.PI);
    rows.push({
      Date: d,
      'Seattle Temperature': round1(53 + 13 * season + (r() - 0.5) * 6),
      'Atlanta Temperature': round1(63 + 17 * season + (r() - 0.5) * 8),
    });
  }
  return rows;
}

function sales(): Row[] {
  const r = rng(11);
  const regions = { North: 120, South: 95, East: 140, West: 110 };
  const rows: Row[] = [];
  for (let m = 1; m <= 12; m++) {
    for (const [region, base] of Object.entries(regions)) {
      const units = Math.round(base * (1 + 0.25 * Math.sin(m / 2)) + r() * 30);
      rows.push({ Month: `2023-${String(m).padStart(2, '0')}`, Region: region, Units: units, Revenue: Math.round(units * (18 + r() * 4)) });
    }
  }
  return rows;
}

function students(): Row[] {
  const r = rng(3);
  const first = ['Ava', 'Ben', 'Chen', 'Dara', 'Eli', 'Femi', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lea', 'Max', 'Nia', 'Oli', 'Pia', 'Quin', 'Rae', 'Sol', 'Tess'];
  return first.map((name, i) => {
    const base = 55 + r() * 35;
    return {
      Name: name,
      Grade: 9 + (i % 4),
      Math: Math.round(Math.min(100, base + (r() - 0.5) * 20)),
      Reading: Math.round(Math.min(100, base + (r() - 0.5) * 20)),
      Writing: Math.round(Math.min(100, base + (r() - 0.5) * 20)),
    };
  });
}

export const SAMPLES: { name: string; description: string; rows: () => Row[] }[] = [
  { name: 'Weekly temperatures (wide)', description: 'one column per city', rows: temperatures },
  { name: 'Regional sales (long)', description: 'one row per month and region', rows: sales },
  { name: 'Student scores', description: 'one row per student', rows: students },
];
