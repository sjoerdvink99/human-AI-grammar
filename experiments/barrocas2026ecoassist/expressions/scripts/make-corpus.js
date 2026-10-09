// Generates the seed training corpus (training_webpages_1) in data/training/.
// Deterministic: re-running produces the same 12 pages.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'training');

const palettes = [
  { name: 'ocean', bg: '#ffffff', surface: '#f2f6fb', text: '#1b2733', accent: '#1f6feb', accent2: '#58a6ff' },
  { name: 'forest', bg: '#fbfdf8', surface: '#eef5e8', text: '#1f2a1c', accent: '#2f855a', accent2: '#9ae6b4' },
  { name: 'sunset', bg: '#fffaf5', surface: '#ffeede', text: '#3a2414', accent: '#dd6b20', accent2: '#f6ad55' },
  { name: 'violet', bg: '#ffffff', surface: '#f5f0ff', text: '#241a3a', accent: '#6b46c1', accent2: '#b794f4' },
  { name: 'mono', bg: '#ffffff', surface: '#f4f4f4', text: '#111111', accent: '#333333', accent2: '#999999' },
  { name: 'sky', bg: '#eaf6ff', surface: '#ffffff', text: '#0b2540', accent: '#0077cc', accent2: '#66c2ff' },
];

const hero = (p, title, sub) => `
  <header class="hero">
    <nav><strong>${title.split(' ')[0]}</strong><span>Product</span><span>Pricing</span><span>About</span><a class="btn" href="#">Sign in</a></nav>
    <h1>${title}</h1>
    <p>${sub}</p>
    <a class="btn big" href="#">Get started</a>
    <svg class="illus" viewBox="0 0 400 160" width="100%" height="200"><rect width="400" height="160" rx="16" fill="${p.accent2}"/><circle cx="90" cy="80" r="50" fill="${p.accent}"/><rect x="170" y="40" width="180" height="20" rx="6" fill="#ffffff"/><rect x="170" y="80" width="140" height="20" rx="6" fill="#ffffff"/></svg>
  </header>`;

const cards = (n, words) =>
  `<section class="grid">${Array.from({ length: n }, (_, i) => `
    <article class="card"><div class="thumb"></div><h3>${words[i % words.length]}</h3>
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus.</p>
    <a href="#">Learn more →</a></article>`).join('')}</section>`;

const article = (title) => `
  <main class="article"><h1>${title}</h1><p class="meta">March 3 · 6 min read</p>
  ${Array.from({ length: 6 }, () => '<p>Sed posuere consectetur est at lobortis. Maecenas faucibus mollis interdum. Cras mattis consectetur purus sit amet fermentum. Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod semper.</p>').join('\n  ')}
  <blockquote>Good design is as little design as possible.</blockquote>
  <div class="banner">Subscribe to the newsletter</div></main>`;

const dashboard = () => `
  <div class="dash"><aside><strong>Admin</strong><p>Overview</p><p>Orders</p><p>Customers</p><p>Settings</p></aside>
  <main><h1>Overview</h1><section class="grid">${['Revenue', 'Orders', 'Visitors', 'Refunds'].map((k, i) => `<div class="card stat"><span>${k}</span><b>${(i + 3) * 1234}</b></div>`).join('')}</section>
  <div class="card chart">${Array.from({ length: 12 }, (_, i) => `<div class="bar" style="height:${30 + ((i * 37) % 120)}px"></div>`).join('')}</div>
  <table><tr><th>Order</th><th>Customer</th><th>Total</th></tr>${Array.from({ length: 8 }, (_, i) => `<tr><td>#10${i}4</td><td>Customer ${i + 1}</td><td>$${(i + 1) * 42}.00</td></tr>`).join('')}</table></main></div>`;

const pricing = () => `
  <main><h1 style="text-align:center">Simple pricing</h1><section class="grid">${['Starter', 'Pro', 'Team'].map((t, i) => `
    <div class="card price ${i === 1 ? 'featured' : ''}"><h3>${t}</h3><b>$${[0, 19, 49][i]}/mo</b><ul><li>Unlimited projects</li><li>Email support</li><li>Analytics</li></ul><a class="btn" href="#">Choose</a></div>`).join('')}</section></main>`;

const layouts = [
  (p) => hero(p, 'Cloud storage for teams', 'Store, share and collaborate on files from anywhere.') + cards(6, ['Fast', 'Secure', 'Shared', 'Synced', 'Backed up', 'Versioned']),
  (p) => article('Ten lessons from a year of gardening'),
  () => dashboard(),
  (p) => hero(p, 'Fresh recipes weekly', 'Cook something new every evening.') + pricing(),
  (p) => cards(9, ['Mountains', 'Lakes', 'Forests', 'Deserts', 'Coasts', 'Cities']),
  (p) => article('Understanding the event loop') + cards(3, ['Related: Promises', 'Related: Streams', 'Related: Workers']),
];

const css = (p) => `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: ${p.bg}; color: ${p.text}; line-height: 1.5; }
  nav { display: flex; gap: 24px; align-items: center; padding: 16px 40px; background: ${p.surface}; }
  nav .btn { margin-left: auto; }
  .hero { background: linear-gradient(135deg, ${p.surface}, ${p.bg}); padding-bottom: 40px; text-align: center; }
  .hero h1 { font-size: 48px; margin: 40px 0 8px; }
  .illus { max-width: 720px; display: block; margin: 24px auto 0; }
  .btn { background: ${p.accent}; color: #fff; padding: 8px 16px; border-radius: 8px; text-decoration: none; }
  .btn.big { padding: 14px 28px; font-size: 18px; display: inline-block; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px; padding: 40px; }
  .card { background: ${p.surface}; border: 1px solid ${p.accent2}; border-radius: 12px; padding: 20px; }
  .thumb { height: 120px; border-radius: 8px; background: linear-gradient(120deg, ${p.accent2}, ${p.accent}); }
  a { color: ${p.accent}; }
  .article { max-width: 720px; margin: 0 auto; padding: 40px 20px; }
  .meta { color: ${p.accent}; }
  blockquote { border-left: 4px solid ${p.accent}; background: ${p.surface}; margin: 0; padding: 16px 24px; font-size: 20px; }
  .banner { margin-top: 32px; padding: 32px; background: ${p.accent}; color: #fff; border-radius: 12px; font-size: 22px; }
  .dash { display: flex; min-height: 100vh; }
  .dash aside { width: 220px; background: ${p.accent}; color: #fff; padding: 24px; }
  .dash main { flex: 1; padding: 0 0 40px; }
  .dash h1 { padding: 0 40px; }
  .stat b { display: block; font-size: 28px; }
  .chart { display: flex; align-items: flex-end; gap: 10px; height: 200px; margin: 0 40px; }
  .bar { flex: 1; background: ${p.accent2}; border-radius: 4px 4px 0 0; }
  table { margin: 24px 40px; border-collapse: collapse; width: calc(100% - 80px); }
  th, td { padding: 10px; border-bottom: 1px solid ${p.surface}; text-align: left; }
  th { background: ${p.surface}; }
  .price b { font-size: 32px; }
  .featured { background: ${p.accent}; color: #fff; }
  .featured .btn { background: #fff; color: ${p.accent}; }`;

await fs.mkdir(OUT, { recursive: true });
let n = 0;
for (let i = 0; i < 12; i++) {
  const p = palettes[i % palettes.length];
  const layout = layouts[(i * 5) % layouts.length];
  const id = `page-${String(++n).padStart(2, '0')}-${p.name}`;
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${id}</title>\n<style>${css(p)}\n</style>\n</head>\n<body>\n${layout(p)}\n</body>\n</html>\n`;
  await fs.writeFile(path.join(OUT, `${id}.html`), html);
}
console.log(`wrote ${n} pages to ${OUT}`);
