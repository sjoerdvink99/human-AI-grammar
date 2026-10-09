import type { WebCode } from "../../shared/types.ts";

/**
 * training_webpages_1: a seeded synthetic corpus of frontend pages.
 * The design calls for 500 profiled webpages but ships none; each generated page mixes a
 * layout template with a random subset of known energy-intensive patterns.
 */

export const PATTERNS: Record<string, string> = {
  "fast-timer": "setInterval/setTimeout firing faster than the display refresh rate",
  "infinite-shadow-animation": "infinite CSS animation of paint-heavy properties (box-shadow, filter)",
  "layout-animation": "animating layout properties (left/top/width) instead of transform",
  "blanket-will-change": "will-change applied to many elements, forcing extra compositor layers",
  "layout-thrashing": "interleaved DOM reads and writes in a loop forcing synchronous layout",
  "busy-polling": "polling the DOM or time on every frame with requestAnimationFrame when nothing changes",
  "non-passive-scroll": "non-passive scroll/touch listeners doing work on every event",
  "eager-images": "many below-the-fold images loaded eagerly",
  "unminified-assets": "large unminified, commented CSS and JS",
  "heavy-dom": "thousands of DOM nodes rendered at once",
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const TEMPLATES = ["landing", "dashboard", "gallery", "blog"] as const;
const COLORS = ["#2b6cb0", "#2f855a", "#c05621", "#6b46c1", "#b83280", "#2c7a7b"];

function svgImg(i: number, color: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='160'><rect width='240' height='160' fill='${color}'/><text x='20' y='90' font-size='28' fill='white'>Image ${i}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface CorpusPage {
  id: string;
  template: string;
  patterns: string[];
  code: WebCode;
}

export function generatePage(index: number, seed = 42): CorpusPage {
  const r = rng(seed * 100003 + index * 7919);
  const template = TEMPLATES[Math.floor(r() * TEMPLATES.length)];
  const color = COLORS[Math.floor(r() * COLORS.length)];
  const patterns = Object.keys(PATTERNS).filter(() => r() < 0.4);
  if (patterns.length === 0) patterns.push(Object.keys(PATTERNS)[Math.floor(r() * 10)]);
  const has = (p: string) => patterns.includes(p);

  const css: string[] = [
    `body { font-family: system-ui, sans-serif; margin: 0; color: #222; }`,
    `header { background: ${color}; color: white; padding: 24px; }`,
    `main { padding: 24px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }`,
    `.card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fff; }`,
    `.badge { display: inline-block; padding: 4px 8px; border-radius: 4px; background: ${color}; color: #fff; }`,
  ];
  const js: string[] = [`const counter = document.getElementById('counter');`, `let ticks = 0;`];
  const cards: string[] = [];
  const nCards = has("heavy-dom") ? 1500 : 12 + Math.floor(r() * 12);

  for (let i = 0; i < nCards; i++) {
    const img = (has("eager-images") && i < 40) || (!has("heavy-dom") && i % 4 === 0) ? `<img src="${svgImg(i, color)}" alt="item ${i}" width="200" height="120">` : "";
    cards.push(`<section class="card"><h3>${template} item ${i}</h3>${img}<p>Lorem ipsum dolor sit amet ${i}.</p></section>`);
  }

  if (has("fast-timer")) js.push(`setInterval(function () { ticks++; counter.textContent = 'Ticks: ' + ticks; }, 1);`);
  else js.push(`setInterval(function () { ticks++; counter.textContent = 'Ticks: ' + ticks; }, 1000);`);

  if (has("infinite-shadow-animation")) {
    css.push(`@keyframes glow { 0% { box-shadow: 0 0 2px ${color}; filter: blur(0px); } 50% { box-shadow: 0 0 40px ${color}; filter: blur(1px); } 100% { box-shadow: 0 0 2px ${color}; filter: blur(0px); } }`);
    css.push(`.card { animation: glow 0.8s infinite; }`);
  }
  if (has("layout-animation")) {
    css.push(`@keyframes slide { from { left: 0; width: 120px; } to { left: 300px; width: 260px; } }`);
    css.push(`.badge { position: relative; animation: slide 1s infinite alternate; }`);
  }
  if (has("blanket-will-change")) css.push(`.card, .card * {\n  will-change: transform, opacity;\n}`);
  if (has("layout-thrashing")) {
    js.push(`function resizeCards() {\n  const cards = document.querySelectorAll('.card');\n  for (let i = 0; i < cards.length; i++) {\n    const h = cards[i].offsetHeight;\n    cards[i].style.minHeight = (h % 7) + 100 + 'px';\n  }\n}\nsetInterval(resizeCards, 50);`);
  }
  if (has("busy-polling")) {
    js.push(`let lastWidth = 0;\nfunction poll() {\n  const w = document.body.getBoundingClientRect().width;\n  if (w !== lastWidth) { lastWidth = w; }\n  document.querySelectorAll('.card').forEach(function (c) { c.dataset.seen = String(Date.now()); });\n  requestAnimationFrame(poll);\n}\nrequestAnimationFrame(poll);`);
  }
  if (has("non-passive-scroll")) {
    js.push(`function onScroll() {\n  document.querySelectorAll('.card').forEach(function (c) { c.getBoundingClientRect(); });\n}\nwindow.addEventListener('scroll', onScroll);\nwindow.addEventListener('wheel', onScroll);`);
    js.push(`let y = 0; setInterval(function () { y = (y + 37) % 2000; window.scrollTo(0, y); }, 30);`);
  }
  if (has("unminified-assets")) {
    for (let i = 0; i < 60; i++) {
      css.push(`/* utility class ${i}: generated spacing helper kept for backwards compatibility */\n.u-${i} {\n  margin: ${i}px;\n  padding: ${i % 9}px;\n}`);
      js.push(`/**\n * Helper ${i}: formats a value for display.\n * Kept unminified for readability during development.\n */\nfunction helper${i}(value) {\n  var result = String(value);\n  return result.padStart(${(i % 5) + 2}, '0');\n}`);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${template} page ${index}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- ${template} template, generated for energy profiling -->
  <header>
    <h1>${template[0].toUpperCase() + template.slice(1)} ${index}</h1>
    <span class="badge" id="counter">Ticks: 0</span>
  </header>
  <main>
    ${cards.join("\n    ")}
  </main>
  <script src="script.js"></script>
</body>
</html>
`;
  return { id: `page-${String(index).padStart(4, "0")}`, template, patterns, code: { html, css: css.join("\n\n") + "\n", js: js.join("\n\n") + "\n" } };
}

export function generateCorpus(n: number, seed = 42): CorpusPage[] {
  return Array.from({ length: n }, (_, i) => generatePage(i, seed));
}
