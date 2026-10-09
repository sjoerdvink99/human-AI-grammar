// tool_2 translate (text -> text_embeddings_1) and tool_3 translate (image -> image_embeddings_1).
// Both are deterministic: hashed TF-IDF for text, colour histogram + thumbnail for image crops.
import sharp from 'sharp';

const DIM = 256;
const STOP = new Set('a an the and or of in on at to with is are was were it its this that by for from as be has have into over under their his her'.split(' '));

export function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function l2normalize(v) {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/**
 * tool_2: one vector per unit from its unit description plus (down-weighted) its artwork description.
 * @param {{unitId:string,artworkId:string}[]} units
 * @param {{unitId:string,text:string}[]} unitDescriptions
 * @param {{artworkId:string,text:string}[]} artworkDescriptions
 */
export function tool2TextEmbed(units, unitDescriptions, artworkDescriptions) {
  const docs = units.map((u) => ({
    unit: tokenize(unitDescriptions.find((d) => d.unitId === u.unitId)?.text || ''),
    art: tokenize(artworkDescriptions.find((d) => d.artworkId === u.artworkId)?.text || ''),
  }));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.unit)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  return units.map((u, i) => {
    const v = new Array(DIM).fill(0);
    const add = (tokens, weight) => {
      for (const t of tokens) {
        const idf = Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
        const h = hash(t);
        v[h % DIM] += (h & 0x80000000 ? -1 : 1) * idf * weight;
      }
    };
    add(docs[i].unit, 1);
    add(docs[i].art, 0.2);
    return { unitId: u.unitId, vector: l2normalize(v) };
  });
}

/**
 * tool_3: one vector per unit from the pixels inside its bounding box.
 * 4x4x4 RGB histogram (64) + 4x4 grey thumbnail (16) + aspect ratio (1).
 */
export async function tool3ImageEmbed(units, imagePathFor) {
  const out = [];
  for (const u of units) {
    const { data } = await sharp(imagePathFor(u.artworkId))
      .extract({ left: u.x, top: u.y, width: u.w, height: u.h })
      .removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const hist = new Array(64).fill(0);
    const thumb = new Array(16).fill(0);
    for (let p = 0; p < 32 * 32; p++) {
      const r = data[p * 3], g = data[p * 3 + 1], b = data[p * 3 + 2];
      hist[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)] += 1;
      const tx = Math.floor((p % 32) / 8), ty = Math.floor(Math.floor(p / 32) / 8);
      thumb[ty * 4 + tx] += (0.299 * r + 0.587 * g + 0.114 * b) / (64 * 255);
    }
    const vec = [...l2normalize(hist), ...l2normalize(thumb).map((x) => x * 0.7), Math.log(u.w / u.h) * 0.3];
    out.push({ unitId: u.unitId, vector: l2normalize(vec) });
  }
  return out;
}

/** Deterministic k-means (k-means++ with a fixed seed) used to give model_3 similarity hints. */
export function kmeans(vectors, k, iters = 30) {
  if (vectors.length === 0) return [];
  k = Math.max(1, Math.min(k, vectors.length));
  const dist = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const centers = [vectors[0].slice()];
  while (centers.length < k) {
    const d = vectors.map((v) => Math.min(...centers.map((c) => dist(v, c))));
    const total = d.reduce((a, b) => a + b, 0);
    let r = rand() * total, idx = 0;
    while (idx < d.length - 1 && (r -= d[idx]) > 0) idx++;
    centers.push(vectors[idx].slice());
  }
  let assign = new Array(vectors.length).fill(0);
  for (let it = 0; it < iters; it++) {
    assign = vectors.map((v) => centers.reduce((best, c, j) => (dist(v, c) < dist(v, centers[best]) ? j : best), 0));
    for (let j = 0; j < k; j++) {
      const members = vectors.filter((_, i) => assign[i] === j);
      if (members.length) centers[j] = members[0].map((_, d) => members.reduce((s, m) => s + m[d], 0) / members.length);
    }
  }
  return assign;
}

export function concatEmbeddings(text, image) {
  return text.map((t) => {
    const im = image.find((i) => i.unitId === t.unitId)?.vector || [];
    return { unitId: t.unitId, vector: [...t.vector, ...im.map((x) => x * 0.8)] };
  });
}
