// Sample artworks: procedurally drawn SVG "paintings" with conventional symbolic motifs, rendered to PNG.
// Run: npm run seed   (resets data/state.json)
import sharp from 'sharp';
import path from 'node:path';
import { IMAGE_DIR, resetState, save } from './store.js';
import { fileURLToPath } from 'node:url';

const W = 512, H = 640;
const frame = (body, bg = '#efe3c8') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="100%" height="100%" fill="${bg}"/><rect x="12" y="12" width="${W - 24}" height="${H - 24}" fill="none" stroke="#7a5a3a" stroke-width="6"/>${body}</svg>`;

const crane = (x, y) => `<g transform="translate(${x},${y})">
<path d="M-60,40 Q0,-10 70,30 Q20,60 -60,40Z" fill="#fff" stroke="#333" stroke-width="2"/>
<path d="M-10,30 L-60,-10 L-20,25Z" fill="#222"/>
<path d="M60,30 Q90,-40 80,-90" fill="none" stroke="#222" stroke-width="7"/>
<circle cx="80" cy="-95" r="12" fill="#fff" stroke="#333" stroke-width="2"/><circle cx="82" cy="-104" r="6" fill="#d11"/>
<path d="M90,-95 L125,-88 L90,-90Z" fill="#a87"/>
<line x1="0" y1="50" x2="-5" y2="140" stroke="#222" stroke-width="4"/><line x1="15" y1="50" x2="20" y2="140" stroke="#222" stroke-width="4"/></g>`;
const pine = (x, y) => `<g transform="translate(${x},${y})"><path d="M0,0 Q-20,-150 30,-320" stroke="#5b3b22" stroke-width="22" fill="none"/>
${[[-60, -250], [40, -300], [70, -200], [-50, -150], [20, -120]].map(([a, b]) => `<ellipse cx="${a}" cy="${b}" rx="70" ry="28" fill="#2f5d34"/>`).join('')}</g>`;
const flower = (x, y, r, c) => `<g transform="translate(${x},${y})">${[0, 60, 120, 180, 240, 300].map((a) => `<ellipse cx="0" cy="${-r * 0.6}" rx="${r * 0.45}" ry="${r * 0.7}" fill="${c}" transform="rotate(${a})" stroke="#8a2040" stroke-width="1"/>`).join('')}<circle r="${r * 0.3}" fill="#f2c94c"/></g>`;
const fish = (x, y, s = 1, c = '#e4672a') => `<g transform="translate(${x},${y}) scale(${s})"><ellipse rx="80" ry="34" fill="${c}"/><path d="M70,0 L120,-35 L110,0 L120,35Z" fill="${c}"/><circle cx="-50" cy="-8" r="6" fill="#111"/><path d="M-20,-30 Q0,-60 30,-30" fill="${c}"/></g>`;
const bat = (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M0,0 Q-30,-30 -70,-10 Q-55,0 -60,15 Q-40,5 -30,20 Q-15,5 0,12 Q15,5 30,20 Q40,5 60,15 Q55,0 70,-10 Q30,-30 0,0Z" fill="#c0262d"/><circle cx="0" cy="0" r="9" fill="#9a1d22"/></g>`;
const cloud = (x, y) => `<g transform="translate(${x},${y})" fill="none" stroke="#3a6ea5" stroke-width="5"><path d="M0,0 q20,-30 45,-5 q25,-25 45,5 q-20,25 -45,10 q-25,15 -45,-10z"/></g>`;
const peach = (x, y) => `<g transform="translate(${x},${y})"><path d="M0,-40 Q45,-40 40,10 Q30,45 0,45 Q-30,45 -40,10 Q-45,-40 0,-40Z" fill="#f4a3a8"/><path d="M0,-40 Q5,0 0,45" stroke="#d97b84" fill="none" stroke-width="3"/><ellipse cx="25" cy="-48" rx="22" ry="9" fill="#5f8f45"/></g>`;
const duck = (x, y, flip = 1) => `<g transform="translate(${x},${y}) scale(${flip},1)"><ellipse rx="55" ry="28" fill="#8a5a2b"/><circle cx="45" cy="-30" r="20" fill="#3f6e5a"/><path d="M62,-30 L85,-25 L62,-22Z" fill="#e05a2a"/><path d="M-10,-25 Q10,-55 30,-20" fill="#e98b2a"/><ellipse cx="45" cy="-34" rx="9" ry="4" fill="#fff"/></g>`;

const ART = [
  { file: 'pine-crane.png', metadata: { title: 'Pine and Crane', period: 'Qing dynasty, 18th c. (style)', origin: 'China', notes: 'Hanging scroll; presented as a birthday gift' },
    svg: frame(`<circle cx="420" cy="90" r="40" fill="#d8412b"/>${pine(140, 600)}${crane(320, 470)}`) },
  { file: 'peony-vase.png', metadata: { title: 'Peonies in a Vase', period: 'Ming dynasty (style)', origin: 'China', notes: 'Album leaf' },
    svg: frame(`<path d="M200,600 Q150,480 210,400 L300,400 Q360,480 310,600Z" fill="#2c5aa0"/><path d="M215,430 h80" stroke="#fff" stroke-width="6"/>${flower(190, 300, 60, '#e0457b')}${flower(320, 270, 55, '#f08aa8')}${flower(260, 200, 50, '#c2185b')}<path d="M255,400 L260,250 M240,400 L190,330 M280,400 L320,300" stroke="#3b6b2b" stroke-width="6"/>`) },
  { file: 'carp-waves.png', metadata: { title: 'Carp Leaping Over Waves', period: 'Edo period (style)', origin: 'Japan', notes: 'Woodblock-style print' },
    svg: frame(`${[480, 530, 580].map((y) => `<path d="M20,${y} q40,-40 80,0 q40,-40 80,0 q40,-40 80,0 q40,-40 80,0 q40,-40 80,0 q40,-40 80,0" fill="none" stroke="#2a5d8f" stroke-width="8"/>`).join('')}<g transform="rotate(-35 256 300)">${fish(256, 300, 1.4)}</g>`) },
  { file: 'bats-clouds.png', metadata: { title: 'Five Bats Among Clouds', period: 'Qing dynasty (style)', origin: 'China', notes: 'Embroidered panel design' },
    svg: frame(`${[[120, 140], [380, 150], [250, 300], [120, 450], [390, 460]].map(([x, y]) => bat(x, y, 1.1)).join('')}${[[200, 200], [60, 300], [330, 360], [220, 520]].map(([x, y]) => cloud(x, y)).join('')}`, '#f3e6c4') },
  { file: 'plum-snow.png', metadata: { title: 'Plum Blossoms in Snow', period: 'Song dynasty (style)', origin: 'China', notes: 'Ink and colour on silk' },
    svg: frame(`<rect x="12" y="520" width="488" height="108" fill="#fafafa"/><path d="M60,560 Q200,420 260,300 Q300,200 440,120" stroke="#3a2a1e" stroke-width="16" fill="none"/><path d="M260,300 Q330,320 400,280" stroke="#3a2a1e" stroke-width="9" fill="none"/>${[[180, 440], [250, 320], [300, 220], [380, 160], [420, 130], [350, 300], [400, 282]].map(([x, y]) => flower(x, y, 18, '#fbe3ea')).join('')}${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 480 + 16}" cy="${(i * 53) % 480 + 20}" r="3" fill="#fff"/>`).join('')}`, '#d9dbe0') },
  { file: 'mandarin-ducks.png', metadata: { title: 'Mandarin Ducks on a Lotus Pond', period: 'Qing dynasty (style)', origin: 'China', notes: 'Painted on a wedding chest panel' },
    svg: frame(`<rect x="12" y="330" width="488" height="298" fill="#9cc3c9"/>${duck(180, 420)}${duck(330, 430, -1)}<ellipse cx="400" cy="560" rx="60" ry="18" fill="#3e7d3a"/><ellipse cx="100" cy="560" rx="50" ry="15" fill="#3e7d3a"/>${flower(420, 300, 35, '#f5a6c0')}<path d="M420,330 L410,550" stroke="#3e7d3a" stroke-width="5"/>`) },
  { file: 'bamboo-rock.png', metadata: { title: 'Bamboo and Rock', period: 'Yuan dynasty (style)', origin: 'China', notes: 'Ink on paper; scholar painting' },
    svg: frame(`<path d="M80,600 Q60,480 140,450 Q220,430 230,520 Q250,600 80,600Z" fill="#7d7d7d"/>${[260, 320, 380].map((x, i) => `<g><rect x="${x}" y="${80 + i * 30}" width="16" height="${520 - i * 30}" fill="#2f6b3a"/>${[200, 320, 440].map((y) => `<rect x="${x - 3}" y="${y}" width="22" height="5" fill="#1f4a28"/><path d="M${x + 16},${y} q50,-15 80,10 q-45,0 -80,-10z" fill="#2f6b3a"/>`).join('')}</g>`).join('')}`) },
  { file: 'peaches-bats.png', metadata: { title: 'Peaches and Bats', period: 'Qing dynasty, Yongzheng (style)', origin: 'China', notes: 'Porcelain dish decoration; imperial birthday ware' },
    svg: frame(`<circle cx="256" cy="330" r="220" fill="#f7f4ec" stroke="#b9a98a" stroke-width="6"/>${peach(200, 330)}${peach(300, 360)}${peach(250, 250)}<path d="M150,250 Q250,200 330,260" stroke="#5b3b22" stroke-width="8" fill="none"/>${bat(140, 450, 0.8)}${bat(370, 200, 0.8)}`) },
];

export async function seed() {
  const s = resetState();
  for (const [i, a] of ART.entries()) {
    await sharp(Buffer.from(a.svg)).png().toFile(path.join(IMAGE_DIR, a.file));
    s.artworks.push({ id: 'art-' + (i + 1), file: a.file, metadata: a.metadata, units: null, description: null, status: 'new' });
  }
  save();
  return s;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().then((s) => console.log(`seeded ${s.artworks.length} artworks`));
}
