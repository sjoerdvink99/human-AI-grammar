import Papa from 'papaparse';
import type { Row, Table } from './types';
import { normalizeTable } from './tools/extract';

// Bundled sample tables (invented numbers, for demonstration).

function fruitSales(): Table {
  const fruits: [string, number[]][] = [
    ['Apples', [120, 135, 160, 150]],
    ['Bananas', [200, 190, 210, 230]],
    ['Cherries', [40, 95, 130, 35]],
    ['Grapes', [80, 85, 150, 170]],
    ['Oranges', [180, 140, 90, 160]],
  ];
  return {
    name: 'fruit_sales_wide',
    columns: ['Fruit', 'Q1', 'Q2', 'Q3', 'Q4'],
    rows: fruits.map(([f, q]) => ({ Fruit: f, Q1: q[0], Q2: q[1], Q3: q[2], Q4: q[3] })),
  };
}

function cityTemps(): Table {
  const rows: Row[] = [];
  const cities: [string, number, number][] = [
    ['Harborview', 9, 7],
    ['Mesa Alta', 18, 12],
    ['Northfield', 2, 14],
  ];
  for (let m = 1; m <= 12; m++) {
    const date = `2025-${String(m).padStart(2, '0')}-01`;
    for (const [city, base, amp] of cities) {
      const t = base + amp * Math.sin(((m - 4) / 12) * 2 * Math.PI);
      rows.push({ Date: date, City: city, Temperature: Math.round(t * 10) / 10 });
    }
  }
  return { name: 'city_temperatures_long', columns: ['Date', 'City', 'Temperature'], rows };
}

function students(): Table {
  const names = ['Ana', 'Bo', 'Chen', 'Dee', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun'];
  const math = [78, 92, 65, 88, 54, 97, 71, 83, 60, 90];
  const reading = [85, 74, 70, 91, 62, 88, 80, 77, 58, 95];
  const hours = [5, 9, 3, 7, 2, 10, 4, 6, 3, 8];
  return {
    name: 'student_scores',
    columns: ['Student', 'Math', 'Reading', 'StudyHours'],
    rows: names.map((n, i) => ({ Student: n, Math: math[i], Reading: reading[i], StudyHours: hours[i] })),
  };
}

export const SAMPLES: Record<string, () => Table> = {
  'Fruit sales (wide)': fruitSales,
  'City temperatures (long)': cityTemps,
  'Student scores': students,
};

export function parseFile(name: string, text: string): Table {
  const base = name.replace(/\.[^.]+$/, '');
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(text) as Row[];
    if (!Array.isArray(data)) throw new Error('JSON must be an array of objects');
    const columns = [...new Set(data.flatMap((r) => Object.keys(r)))];
    return normalizeTable({ name: base, columns, rows: data });
  }
  const parsed = Papa.parse<Row>(text.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true });
  return normalizeTable({ name: base, columns: parsed.meta.fields ?? [], rows: parsed.data });
}
