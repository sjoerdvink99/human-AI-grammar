// Demo dataset: synthetic street scenes (rendered to PNG) with object annotations (r1, r2),
// plus a seed guideline library (r8), user profile (r9), taxonomy (r10) and instruction (r7).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const W = 640, H = 400;

export const DEMO_INSTRUCTION = 'Label each street scene by the risk it poses to pedestrians: high_risk, medium_risk or low_risk.';

export const DEMO_GUIDELINES = [
  { id: 'g1', name: 'Pedestrian in roadway', rule: 'If a person is standing or walking on the road outside a crosswalk while a car is present, label high_risk.', label: 'high_risk' },
  { id: 'g2', name: 'Crosswalk with traffic', rule: 'If people cross at a crosswalk and a car is close to the crossing, label medium_risk.', label: 'medium_risk' },
  { id: 'g3', name: 'Cyclist sharing road', rule: 'If a bicycle rides on the road next to cars, label medium_risk.', label: 'medium_risk' },
  { id: 'g4', name: 'No vehicles', rule: 'If there are no cars on the road, label low_risk.', label: 'low_risk' },
  { id: 'g5', name: 'Sidewalk only', rule: 'If all people are on the sidewalk or in a park away from the road, label low_risk.', label: 'low_risk' },
  { id: 'g6', name: 'Parked vehicles', rule: 'If cars are parked in a parking lot and people walk between them, label medium_risk.', label: 'medium_risk' },
];

export const DEMO_PROFILE = {
  preferences: ['Prefer the more cautious label when unsure.'],
  summary: 'New labeler; no history yet.',
};

export const DEMO_TAXONOMY = {
  nodes: [
    { id: 'scene', name: 'Scene', parent: null },
    { id: 'road', name: 'Road', parent: 'scene' },
    { id: 'intersection', name: 'Intersection / crosswalk', parent: 'road' },
    { id: 'street', name: 'Open street', parent: 'road' },
    { id: 'pedestrian_area', name: 'Pedestrian area', parent: 'scene' },
    { id: 'park', name: 'Park', parent: 'pedestrian_area' },
    { id: 'sidewalk', name: 'Sidewalk', parent: 'pedestrian_area' },
    { id: 'parking', name: 'Parking lot', parent: 'scene' },
  ],
};

// ---- drawing primitives: each returns {svg, obj} ----
const car = (x, y, color = '#c0392b') => ({
  svg: `<rect x="${x}" y="${y + 12}" width="90" height="28" rx="6" fill="${color}"/><rect x="${x + 18}" y="${y}" width="50" height="18" rx="5" fill="${color}"/><rect x="${x + 24}" y="${y + 4}" width="38" height="10" fill="#cfe8ff"/><circle cx="${x + 20}" cy="${y + 40}" r="9" fill="#222"/><circle cx="${x + 70}" cy="${y + 40}" r="9" fill="#222"/>`,
  obj: { label: 'car', bbox: [x, y, 90, 49] },
});
const person = (x, y, shirt = '#2e86de') => ({
  svg: `<circle cx="${x + 8}" cy="${y + 7}" r="7" fill="#f1c27d"/><rect x="${x + 1}" y="${y + 14}" width="14" height="22" rx="3" fill="${shirt}"/><rect x="${x + 2}" y="${y + 36}" width="5" height="16" fill="#333"/><rect x="${x + 9}" y="${y + 36}" width="5" height="16" fill="#333"/>`,
  obj: { label: 'person', bbox: [x, y, 16, 52] },
});
const bike = (x, y) => ({
  svg: `<circle cx="${x + 10}" cy="${y + 35}" r="10" fill="none" stroke="#111" stroke-width="3"/><circle cx="${x + 45}" cy="${y + 35}" r="10" fill="none" stroke="#111" stroke-width="3"/><path d="M${x + 10} ${y + 35} L${x + 25} ${y + 20} L${x + 45} ${y + 35} M${x + 25} ${y + 20} L${x + 38} ${y + 20}" stroke="#e67e22" stroke-width="3" fill="none"/><circle cx="${x + 27}" cy="${y + 2}" r="6" fill="#f1c27d"/><rect x="${x + 22}" y="${y + 8}" width="10" height="13" fill="#27ae60"/>`,
  obj: { label: 'bicycle', bbox: [x, y - 4, 56, 50] },
});
const light = (x, y, on = 'red') => ({
  svg: `<rect x="${x + 6}" y="${y + 40}" width="4" height="60" fill="#444"/><rect x="${x}" y="${y}" width="16" height="42" rx="3" fill="#222"/><circle cx="${x + 8}" cy="${y + 9}" r="5" fill="${on === 'red' ? '#e74c3c' : '#555'}"/><circle cx="${x + 8}" cy="${y + 21}" r="5" fill="#555"/><circle cx="${x + 8}" cy="${y + 33}" r="5" fill="${on === 'green' ? '#2ecc71' : '#555'}"/>`,
  obj: { label: 'traffic light', bbox: [x, y, 16, 100] },
});
const tree = (x, y) => ({
  svg: `<rect x="${x + 22}" y="${y + 50}" width="10" height="40" fill="#8e5a2b"/><circle cx="${x + 27}" cy="${y + 30}" r="30" fill="#2d8a4e"/>`,
  obj: { label: 'tree', bbox: [x - 3, y, 60, 90] },
});
const bench = (x, y) => ({
  svg: `<rect x="${x}" y="${y}" width="60" height="8" fill="#8e5a2b"/><rect x="${x + 4}" y="${y + 8}" width="4" height="14" fill="#555"/><rect x="${x + 52}" y="${y + 8}" width="4" height="14" fill="#555"/>`,
  obj: { label: 'bench', bbox: [x, y, 60, 22] },
});

const sky = `<rect width="${W}" height="${H}" fill="#bfe3ff"/>`;
const road = (y = 250, h = 110) => `<rect x="0" y="${y}" width="${W}" height="${h}" fill="#6b6b6b"/><line x1="0" y1="${y + h / 2}" x2="${W}" y2="${y + h / 2}" stroke="#f5d142" stroke-width="4" stroke-dasharray="20 15"/>`;
const sidewalk = (y = 220, h = 30) => `<rect x="0" y="${y}" width="${W}" height="${h}" fill="#d5d5d5"/><rect x="0" y="${y - 20}" width="${W}" height="20" fill="#9fd18f"/>`;
const grass = (y = 220) => `<rect x="0" y="${y}" width="${W}" height="${H - y}" fill="#7cc46b"/>`;
const crosswalk = (x, y = 250, h = 110) => Array.from({ length: 6 }, (_, i) => `<rect x="${x + i * 16}" y="${y}" width="9" height="${h}" fill="#fff"/>`).join('');
const parkingLot = `<rect x="0" y="200" width="${W}" height="${H - 200}" fill="#8a8a8a"/>${Array.from({ length: 7 }, (_, i) => `<rect x="${20 + i * 90}" y="220" width="4" height="70" fill="#fff"/>`).join('')}`;

const SCENES = [
  { id: 'scene_01', bg: sky + sidewalk() + road(), parts: [car(380, 285), person(200, 280, '#8e44ad'), light(560, 120)] },
  { id: 'scene_02', bg: sky + sidewalk() + road() + crosswalk(260), parts: [person(275, 270), person(300, 300, '#16a085'), car(420, 262, '#2c3e50'), light(230, 120, 'green')] },
  { id: 'scene_03', bg: sky + sidewalk() + road(), parts: [bike(250, 290), car(80, 288, '#2980b9'), car(450, 262)] },
  { id: 'scene_04', bg: sky + grass(), parts: [tree(80, 140), tree(470, 130), person(260, 260), person(300, 270, '#e67e22'), bench(380, 300)] },
  { id: 'scene_05', bg: sky + sidewalk() + road(), parts: [person(120, 175), person(430, 170, '#c0392b'), tree(520, 120)] },
  { id: 'scene_06', bg: sky + parkingLot, parts: [car(40, 230, '#7f8c8d'), car(220, 232, '#27ae60'), person(160, 300), car(400, 230)] },
  { id: 'scene_07', bg: sky + sidewalk() + road(), parts: [person(330, 168), car(150, 262, '#f39c12'), car(470, 290, '#2c3e50'), light(40, 120)] },
  { id: 'scene_08', bg: sky + sidewalk() + road() + crosswalk(300), parts: [person(320, 300), light(270, 120, 'red')] },
];

export async function buildDemo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const images = [];
  const annotations = [];
  for (const sc of SCENES) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${sc.bg}${sc.parts.map((p) => p.svg).join('')}</svg>`;
    const file = `${sc.id}.png`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(dir, file));
    images.push({ id: sc.id, file, width: W, height: H });
    annotations.push({ imageId: sc.id, objects: sc.parts.map((p) => p.obj) });
  }
  return { images, annotations };
}
