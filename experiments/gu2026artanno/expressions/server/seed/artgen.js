// Procedural "naive painting" generator used to create a sample collection
// (artworks_1 + artwork_metadata_1). Each object drawn returns its bounding box and a basic label.

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const W = 640, H = 480;

const PALETTES = {
  dawn: { sky: ['#f6c28b', '#f9e2c0'], ground: '#9bb06a', ink: '#3b2a1e', cloth: ['#8e2f2f', '#2f4f8e', '#c79a2b', '#5a7a3a'] },
  night: { sky: ['#101a3a', '#2b3a6b'], ground: '#2d3b2a', ink: '#e8e2c8', cloth: ['#a33', '#6a8fd0', '#d8c060', '#9c6ab0'] },
  pastoral: { sky: ['#8ec5e8', '#dcefff'], ground: '#7aa452', ink: '#2a2a2a', cloth: ['#b8402f', '#2f5fa0', '#e0b040', '#6b3f8c'] },
  sea: { sky: ['#a9cfe6', '#eef6fb'], ground: '#d9c38a', ink: '#1f2a33', cloth: ['#c2452d', '#1f4f7a', '#e1b74a', '#3f7a5a'] },
  gold: { sky: ['#c9a227', '#f2dc8a'], ground: '#7c5a2e', ink: '#2b1a0e', cloth: ['#8b1e1e', '#1e3b8b', '#f4f0e0', '#2e6b3a'] },
};

function figure(x, y, s, pose, c, opts = {}) {
  // (x,y) = feet position, s = scale (height ~ 120*s)
  const h = 120 * s, head = 11 * s;
  const ink = c.ink, cloth = opts.cloth;
  let parts = [];
  let top = y - h, bottom = y, left = x - 22 * s, right = x + 22 * s;
  if (pose === 'seated') {
    const seatY = y - 40 * s;
    parts.push(`<rect x="${x - 26 * s}" y="${seatY}" width="${52 * s}" height="${40 * s}" fill="#6b4a2b"/>`);
    parts.push(`<path d="M${x - 16 * s},${seatY} L${x + 16 * s},${seatY} L${x + 12 * s},${seatY - 50 * s} L${x - 12 * s},${seatY - 50 * s} Z" fill="${cloth}"/>`);
    parts.push(`<path d="M${x + 14 * s},${seatY} L${x + 34 * s},${seatY} L${x + 34 * s},${y}" stroke="${cloth}" stroke-width="${9 * s}" fill="none"/>`);
    parts.push(`<circle cx="${x}" cy="${seatY - 50 * s - head}" r="${head}" fill="#e7c7a0" stroke="${ink}"/>`);
    parts.push(`<rect x="${x + 6 * s}" y="${seatY - 34 * s}" width="${18 * s}" height="${13 * s}" fill="#f4f0e0" stroke="${ink}"/>`);
    top = seatY - 50 * s - 2 * head; right = x + 36 * s; left = x - 28 * s;
  } else if (pose === 'kneeling') {
    const hip = y - 30 * s;
    parts.push(`<path d="M${x - 14 * s},${hip} L${x + 30 * s},${y} L${x - 14 * s},${y} Z" fill="${cloth}"/>`);
    parts.push(`<path d="M${x - 14 * s},${hip + 4 * s} L${x + 12 * s},${hip + 4 * s} L${x + 8 * s},${hip - 48 * s} L${x - 12 * s},${hip - 48 * s} Z" fill="${cloth}"/>`);
    parts.push(`<path d="M${x + 6 * s},${hip - 36 * s} L${x + 24 * s},${hip - 50 * s}" stroke="${ink}" stroke-width="${4 * s}"/>`);
    parts.push(`<circle cx="${x + 4 * s}" cy="${hip - 48 * s - head}" r="${head}" fill="#e7c7a0" stroke="${ink}"/>`);
    top = hip - 48 * s - 2 * head; right = x + 32 * s; left = x - 16 * s;
  } else {
    const sc = pose === 'child' ? 0.6 : 1;
    const hh = h * sc, hd = head * sc;
    const sh = y - hh + 2 * hd;
    parts.push(`<path d="M${x - 9 * s * sc},${sh} L${x + 9 * s * sc},${sh} L${x + 18 * s * sc},${y} L${x - 18 * s * sc},${y} Z" fill="${cloth}"/>`);
    parts.push(`<circle cx="${x}" cy="${sh - hd}" r="${hd}" fill="#e7c7a0" stroke="${ink}"/>`);
    if (pose === 'orant') {
      parts.push(`<path d="M${x - 8 * s},${sh + 6 * s} L${x - 26 * s},${sh - 30 * s} M${x + 8 * s},${sh + 6 * s} L${x + 26 * s},${sh - 30 * s}" stroke="${ink}" stroke-width="${4 * s}"/>`);
      top = sh - 32 * s; left = x - 28 * s; right = x + 28 * s;
    } else {
      parts.push(`<path d="M${x - 8 * s * sc},${sh + 6 * s} L${x - 16 * s * sc},${sh + 46 * s * sc} M${x + 8 * s * sc},${sh + 6 * s} L${x + 18 * s * sc},${sh + 40 * s * sc}" stroke="${ink}" stroke-width="${4 * s * sc}"/>`);
      if (opts.staff) parts.push(`<path d="M${x + 20 * s},${sh - 20 * s} L${x + 20 * s},${y}" stroke="#5a3b1e" stroke-width="${3 * s}"/>`);
      top = y - hh - (opts.staff ? 20 * s : 0); left = x - 20 * s * sc; right = x + 22 * s * sc;
    }
  }
  if (opts.halo) {
    // halo drawn behind the head: approximate head centre at top + head radius
    parts.unshift(`<circle cx="${pose === 'kneeling' ? x + 4 * s : x}" cy="${top + head * (pose === 'orant' ? 3.8 : 1.1)}" r="${head * 1.8}" fill="#f2d24b" opacity="0.9"/>`);
    top -= head * 0.8;
  }
  return { svg: parts.join(''), bbox: [left, top, right - left, bottom - top] };
}

function horse(x, y, s, c, rider) {
  const col = rider ? '#7a4a28' : '#d8d0c0';
  let svg = `<ellipse cx="${x}" cy="${y - 50 * s}" rx="${42 * s}" ry="${18 * s}" fill="${col}" stroke="${c.ink}"/>`;
  svg += `<path d="M${x + 34 * s},${y - 58 * s} L${x + 56 * s},${y - 92 * s} L${x + 66 * s},${y - 86 * s} L${x + 44 * s},${y - 50 * s} Z" fill="${col}" stroke="${c.ink}"/>`;
  for (const dx of [-30, -18, 20, 32]) svg += `<path d="M${x + dx * s},${y - 38 * s} L${x + dx * s},${y}" stroke="${c.ink}" stroke-width="${5 * s}"/>`;
  svg += `<path d="M${x - 42 * s},${y - 54 * s} Q${x - 60 * s},${y - 40 * s} ${x - 54 * s},${y - 20 * s}" stroke="${c.ink}" stroke-width="${4 * s}" fill="none"/>`;
  let top = y - 94 * s;
  if (rider) {
    svg += `<path d="M${x - 8 * s},${y - 64 * s} L${x + 10 * s},${y - 64 * s} L${x + 6 * s},${y - 110 * s} L${x - 6 * s},${y - 110 * s} Z" fill="${rider}"/>`;
    svg += `<circle cx="${x}" cy="${y - 121 * s}" r="${11 * s}" fill="#e7c7a0" stroke="${c.ink}"/>`;
    svg += `<path d="M${x + 6 * s},${y - 100 * s} L${x + 40 * s},${y - 120 * s}" stroke="${c.ink}" stroke-width="${3 * s}"/>`;
    top = y - 134 * s;
  }
  return { svg, bbox: [x - 60 * s, top, 128 * s, y - top] };
}

function dog(x, y, s, c) {
  const svg = `<ellipse cx="${x}" cy="${y - 20 * s}" rx="${22 * s}" ry="${9 * s}" fill="#8a6a4a" stroke="${c.ink}"/>`
    + `<circle cx="${x + 24 * s}" cy="${y - 30 * s}" r="${8 * s}" fill="#8a6a4a" stroke="${c.ink}"/>`
    + `<path d="M${x - 14 * s},${y - 14 * s} L${x - 14 * s},${y} M${x + 12 * s},${y - 14 * s} L${x + 12 * s},${y} M${x - 22 * s},${y - 22 * s} L${x - 32 * s},${y - 34 * s}" stroke="${c.ink}" stroke-width="${3 * s}"/>`;
  return { svg, bbox: [x - 34 * s, y - 40 * s, 68 * s, 40 * s] };
}

function bird(x, y, s, c) {
  const svg = `<path d="M${x - 20 * s},${y} Q${x - 10 * s},${y - 14 * s} ${x},${y} Q${x + 10 * s},${y - 14 * s} ${x + 20 * s},${y}" stroke="${c.ink}" stroke-width="${3 * s}" fill="none"/>`;
  return { svg, bbox: [x - 22 * s, y - 14 * s, 44 * s, 18 * s] };
}

function fish(x, y, s) {
  const svg = `<ellipse cx="${x}" cy="${y}" rx="${18 * s}" ry="${8 * s}" fill="#d0a040"/><path d="M${x - 16 * s},${y} L${x - 28 * s},${y - 9 * s} L${x - 28 * s},${y + 9 * s} Z" fill="#d0a040"/>`;
  return { svg, bbox: [x - 30 * s, y - 10 * s, 50 * s, 20 * s] };
}

function tree(x, y, s, c) {
  const svg = `<rect x="${x - 5 * s}" y="${y - 60 * s}" width="${10 * s}" height="${60 * s}" fill="#5a3b1e"/>`
    + `<circle cx="${x}" cy="${y - 85 * s}" r="${34 * s}" fill="#3f6b2e" stroke="${c.ink}" stroke-opacity="0.4"/>`;
  return { svg, bbox: [x - 34 * s, y - 119 * s, 68 * s, 119 * s] };
}

function mountain(x, y, s, c) {
  const svg = `<path d="M${x - 110 * s},${y} L${x},${y - 140 * s} L${x + 110 * s},${y} Z" fill="#7d7f8c" stroke="${c.ink}" stroke-opacity="0.3"/>`
    + `<path d="M${x - 26 * s},${y - 107 * s} L${x},${y - 140 * s} L${x + 26 * s},${y - 107 * s} Z" fill="#f4f4f4"/>`;
  return { svg, bbox: [x - 110 * s, y - 140 * s, 220 * s, 140 * s] };
}

function sun(x, y, s) {
  let svg = `<circle cx="${x}" cy="${y}" r="${26 * s}" fill="#f7b733"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    svg += `<path d="M${x + Math.cos(a) * 32 * s},${y + Math.sin(a) * 32 * s} L${x + Math.cos(a) * 44 * s},${y + Math.sin(a) * 44 * s}" stroke="#f7b733" stroke-width="${3 * s}"/>`;
  }
  return { svg, bbox: [x - 45 * s, y - 45 * s, 90 * s, 90 * s] };
}

function moon(x, y, s, c) {
  const svg = `<circle cx="${x}" cy="${y}" r="${24 * s}" fill="#f1e9c6"/><circle cx="${x + 11 * s}" cy="${y - 6 * s}" r="${22 * s}" fill="${c.sky[0]}"/>`;
  return { svg, bbox: [x - 25 * s, y - 25 * s, 40 * s, 50 * s] };
}

function star(x, y, s) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = (i % 2 ? 7 : 18) * s, a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${x + Math.cos(a) * r},${y + Math.sin(a) * r}`);
  }
  return { svg: `<polygon points="${pts.join(' ')}" fill="#fff3a0"/>`, bbox: [x - 18 * s, y - 18 * s, 36 * s, 36 * s] };
}

function house(x, y, s, c) {
  const svg = `<rect x="${x - 40 * s}" y="${y - 50 * s}" width="${80 * s}" height="${50 * s}" fill="#d9b48a" stroke="${c.ink}"/>`
    + `<path d="M${x - 48 * s},${y - 50 * s} L${x},${y - 86 * s} L${x + 48 * s},${y - 50 * s} Z" fill="#9c3d2b" stroke="${c.ink}"/>`
    + `<rect x="${x - 8 * s}" y="${y - 28 * s}" width="${16 * s}" height="${28 * s}" fill="#5a3b1e"/>`;
  return { svg, bbox: [x - 48 * s, y - 86 * s, 96 * s, 86 * s] };
}

function tower(x, y, s, c) {
  const svg = `<rect x="${x - 16 * s}" y="${y - 150 * s}" width="${32 * s}" height="${150 * s}" fill="#bfb6a6" stroke="${c.ink}"/>`
    + `<rect x="${x - 20 * s}" y="${y - 164 * s}" width="${40 * s}" height="${14 * s}" fill="#8a8172" stroke="${c.ink}"/>`
    + `<rect x="${x - 5 * s}" y="${y - 130 * s}" width="${10 * s}" height="${16 * s}" fill="#333"/>`;
  return { svg, bbox: [x - 20 * s, y - 164 * s, 40 * s, 164 * s] };
}

function temple(x, y, s, c) {
  const svg = `<rect x="${x - 50 * s}" y="${y - 60 * s}" width="${100 * s}" height="${60 * s}" fill="#ece3cf" stroke="${c.ink}"/>`
    + `<path d="M${x - 30 * s},${y - 60 * s} A${30 * s},${30 * s} 0 0 1 ${x + 30 * s},${y - 60 * s} Z" fill="#c9a24b" stroke="${c.ink}"/>`
    + `<path d="M${x},${y - 90 * s} L${x},${y - 118 * s} M${x - 9 * s},${y - 108 * s} L${x + 9 * s},${y - 108 * s}" stroke="${c.ink}" stroke-width="${3 * s}"/>`
    + `<path d="M${x - 10 * s},${y} L${x - 10 * s},${y - 26 * s} A${10 * s},${10 * s} 0 0 1 ${x + 10 * s},${y - 26 * s} L${x + 10 * s},${y} Z" fill="#5a3b1e"/>`;
  return { svg, bbox: [x - 50 * s, y - 118 * s, 100 * s, 118 * s] };
}

function sailboat(x, y, s, c) {
  const svg = `<path d="M${x - 40 * s},${y - 14 * s} L${x + 40 * s},${y - 14 * s} L${x + 28 * s},${y} L${x - 28 * s},${y} Z" fill="#6b3f1e" stroke="${c.ink}"/>`
    + `<path d="M${x},${y - 14 * s} L${x},${y - 90 * s}" stroke="${c.ink}" stroke-width="${3 * s}"/>`
    + `<path d="M${x + 3 * s},${y - 86 * s} L${x + 36 * s},${y - 20 * s} L${x + 3 * s},${y - 20 * s} Z" fill="#f4f0e0" stroke="${c.ink}"/>`;
  return { svg, bbox: [x - 40 * s, y - 90 * s, 80 * s, 90 * s] };
}

function rowboat(x, y, s, c) {
  const svg = `<path d="M${x - 34 * s},${y - 12 * s} L${x + 34 * s},${y - 12 * s} L${x + 24 * s},${y} L${x - 24 * s},${y} Z" fill="#8a5a2e" stroke="${c.ink}"/>`
    + `<path d="M${x - 10 * s},${y - 8 * s} L${x - 40 * s},${y + 10 * s}" stroke="${c.ink}" stroke-width="${3 * s}"/>`;
  return { svg, bbox: [x - 40 * s, y - 14 * s, 76 * s, 26 * s] };
}

// Scene recipes: title, palette, sea?, list of [drawer, basicLabel, args]
const SCENES = [
  { title: 'Annunciation in a Garden', pal: 'gold', items: ['fig:orant:halo', 'fig:kneeling', 'tree', 'temple', 'star'] },
  { title: 'Pilgrims on the Road', pal: 'dawn', items: ['fig:standing:staff', 'fig:standing:staff', 'fig:child', 'dog', 'mountain', 'sun'] },
  { title: 'The Harbour at Dusk', pal: 'sea', sea: true, items: ['sailboat', 'rowboat', 'tower', 'bird', 'bird', 'fish'] },
  { title: 'Saint in the Wilderness', pal: 'pastoral', items: ['fig:kneeling:halo', 'mountain', 'tree', 'bird', 'sun'] },
  { title: 'Night Procession', pal: 'night', items: ['fig:standing', 'fig:standing', 'fig:orant', 'temple', 'moon', 'star'] },
  { title: 'Rider before the Town', pal: 'pastoral', items: ['horse:rider', 'house', 'house', 'tower', 'tree', 'dog'] },
  { title: 'Scholar at Rest', pal: 'dawn', items: ['fig:seated', 'tree', 'house', 'bird', 'sun'] },
  { title: 'Fishermen\'s Prayer', pal: 'sea', sea: true, items: ['rowboat', 'sailboat', 'fish', 'fish', 'temple', 'star'] },
  { title: 'Enthroned Saint with Donor', pal: 'gold', items: ['fig:seated:halo', 'fig:kneeling', 'fig:child', 'star', 'tree'] },
  { title: 'The Horse Fair', pal: 'pastoral', items: ['horse', 'horse:rider', 'fig:standing', 'dog', 'house', 'sun'] },
  { title: 'Lament under the Moon', pal: 'night', items: ['fig:orant', 'fig:kneeling', 'fig:kneeling', 'mountain', 'moon'] },
  { title: 'Morning on the Coast', pal: 'sea', sea: true, items: ['sailboat', 'sailboat', 'bird', 'sun', 'tower', 'fig:standing'] },
];

const ARTISTS = ['Master of the Pale Hills', 'Anonymous (workshop)', 'J. van Oord', 'Circle of the Lantern Master', 'M. Ferrante'];

export function generateCollection(seed = 7) {
  const r = rng(seed);
  return SCENES.map((scene, i) => {
    const c = PALETTES[scene.pal];
    const horizon = scene.sea ? 300 : 320;
    let body = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.sky[0]}"/><stop offset="1" stop-color="${c.sky[1]}"/></linearGradient></defs>`;
    body += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
    if (scene.sea) {
      body += `<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="#3d6f93"/>`;
      body += `<rect y="${H - 50}" width="${W}" height="50" fill="${c.ground}"/>`;
    } else {
      body += `<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${c.ground}"/>`;
    }
    const objects = [];
    const layers = { back: [], mid: [], front: [] };
    const n = scene.items.length;
    let slot = 0;
    for (const item of scene.items) {
      const [kind, a, b] = item.split(':');
      const xs = 70 + ((slot + 0.5) / n) * (W - 140) + (r() - 0.5) * 30;
      slot++;
      const groundY = horizon + 40 + r() * 90;
      let o, label, layer = 'mid';
      const cloth = c.cloth[Math.floor(r() * c.cloth.length)];
      switch (kind) {
        case 'fig': o = figure(xs, groundY, 0.9 + r() * 0.2, a, c, { halo: a === 'halo' || b === 'halo', staff: b === 'staff', cloth }); label = 'person'; layer = 'front'; break;
        case 'horse': o = horse(xs, groundY, 0.8, c, a === 'rider' ? cloth : null); label = a === 'rider' ? 'person' : 'animal'; layer = 'front'; break;
        case 'dog': o = dog(xs, groundY + 10, 0.9, c); label = 'animal'; layer = 'front'; break;
        case 'bird': o = bird(xs, 60 + r() * 120, 1, c); label = 'animal'; break;
        case 'fish': o = fish(xs, horizon + 60 + r() * 80, 1.1); label = 'animal'; break;
        case 'tree': o = tree(xs, horizon + 30 + r() * 40, 1, c); label = 'plant'; layer = 'back'; break;
        case 'mountain': o = mountain(xs, horizon, 1, c); label = 'landform'; layer = 'back'; break;
        case 'sun': o = sun(xs, 70 + r() * 30, 0.9); label = 'celestial'; layer = 'back'; break;
        case 'moon': o = moon(xs, 70 + r() * 30, 1, c); label = 'celestial'; layer = 'back'; break;
        case 'star': o = star(xs, 50 + r() * 60, 1); label = 'celestial'; layer = 'back'; break;
        case 'house': o = house(xs, horizon + 20 + r() * 20, 0.9, c); label = 'building'; layer = 'back'; break;
        case 'tower': o = tower(xs, scene.sea ? H - 40 : horizon + 30, 0.9, c); label = 'building'; layer = 'back'; break;
        case 'temple': o = temple(xs, scene.sea ? H - 40 : horizon + 30, 0.9, c); label = 'building'; layer = 'back'; break;
        case 'sailboat': o = sailboat(xs, horizon + 50 + r() * 60, 1, c); label = 'boat'; break;
        case 'rowboat': o = rowboat(xs, horizon + 70 + r() * 50, 1, c); label = 'boat'; break;
        default: continue;
      }
      layers[layer].push(o.svg);
      const [x, y, w, h] = o.bbox.map((v) => Math.round(v));
      const cx = Math.max(0, x), cy = Math.max(0, y);
      objects.push({ label, bbox: [cx, cy, Math.min(W - cx, w - (cx - x)), Math.min(H - cy, h - (cy - y))] });
    }
    body += layers.back.join('') + layers.mid.join('') + layers.front.join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
    return {
      id: `art-${String(i + 1).padStart(2, '0')}`,
      svg,
      metadata: {
        title: scene.title,
        artist: ARTISTS[i % ARTISTS.length],
        year: 1420 + Math.floor(r() * 200),
        medium: scene.pal === 'gold' ? 'Tempera and gold leaf on panel' : 'Oil on panel',
        objects,
      },
    };
  });
}
