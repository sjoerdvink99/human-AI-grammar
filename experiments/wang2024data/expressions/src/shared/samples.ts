import type { Table } from './types';

/** Bundled example tables, so the app can be tried without uploading a file. */

function temperatures(): Table {
  // Daily highs (°F) for two cities, in wide format: one column per city.
  const rows = [];
  const start = Date.UTC(2020, 0, 1);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60; i++) {
    const d = new Date(start + i * 7 * 86400000);
    const season = Math.sin(((i * 7 - 100) / 365) * 2 * Math.PI);
    rows.push({
      Date: d.toISOString().slice(0, 10),
      Seattle: Math.round(58 + 17 * season + (rand() - 0.5) * 8),
      Atlanta: Math.round(73 + 18 * season + (rand() - 0.5) * 8),
    });
  }
  return { columns: ['Date', 'Seattle', 'Atlanta'], rows };
}

const students: Table = {
  columns: ['Name', 'Major', 'Math', 'Reading', 'Writing'],
  rows: [
    ['Ava', 'Biology', 82, 91, 88],
    ['Ben', 'History', 64, 88, 90],
    ['Chen', 'Physics', 97, 79, 74],
    ['Dara', 'Biology', 75, 84, 81],
    ['Eli', 'Physics', 91, 70, 68],
    ['Fay', 'History', 58, 93, 95],
    ['Gus', 'Economics', 88, 76, 72],
    ['Hana', 'Economics', 79, 82, 85],
    ['Ivo', 'Physics', 85, 67, 70],
    ['Jo', 'Biology', 70, 89, 92],
  ].map(([Name, Major, Math, Reading, Writing]) => ({ Name, Major, Math, Reading, Writing })),
};

export const SAMPLES: Record<string, () => Table> = {
  'Weekly temperatures (wide)': temperatures,
  'Student scores (wide)': () => students,
};
