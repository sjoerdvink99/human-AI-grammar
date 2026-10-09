// tool_2 translate (text similarity embeddings) and tool_3 translate (image similarity embeddings).
// Both are deterministic, local substitutes for embedding models (no API key available).
import sharp from 'sharp';

const STOP = new Set('a an the of and or in on with to is are at by for from as its it this that these those be has have which into over under among'.split(' '));
const tokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** tool_2: TF-IDF vectors (L2 normalised) over unit descriptions + artwork description context. */
export function textEmbeddings(docs /* {id, text}[] */) {
  const toks = docs.map((d) => tokens(d.text));
  const df = new Map();
  toks.forEach((ts) => new Set(ts).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const vocab = [...df.keys()].filter((t) => df.get(t) < docs.length || docs.length < 3).sort();
  const idx = new Map(vocab.map((t, i) => [t, i]));
  const out = {};
  docs.forEach((d, i) => {
    const v = new Array(vocab.length).fill(0);
    toks[i].forEach((t) => { if (idx.has(t)) v[idx.get(t)] += 1; });
    vocab.forEach((t, j) => { v[j] *= Math.log((1 + docs.length) / (1 + df.get(t))) + 1; });
    out[d.id] = normalise(v);
  });
  return out;
}

/** tool_3: colour histogram (4×4×4 bins) + 8×8 grayscale layout of a unit's region. */
export async function imageEmbedding(file, box) {
  let img = sharp(file);
  if (box) {
    const m = await img.metadata();
    const left = Math.max(0, Math.round(box.x * m.width)), top = Math.max(0, Math.round(box.y * m.height));
    const width = Math.max(1, Math.min(m.width - left, Math.round(box.w * m.width)));
    const height = Math.max(1, Math.min(m.height - top, Math.round(box.h * m.height)));
    img = sharp(await sharp(file).extract({ left, top, width, height }).toBuffer());
  }
  const { data } = await img.clone().resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const hist = new Array(64).fill(0);
  for (let i = 0; i < data.length; i += 3) hist[(data[i] >> 6) * 16 + (data[i + 1] >> 6) * 4 + (data[i + 2] >> 6)]++;
  const gray = await img.clone().resize(8, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  return [...normalise(hist), ...normalise([...gray].map((g) => g / 255 - 0.5)).map((x) => x * 0.5)];
}

export function normalise(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

/** Render the embedding representations compactly for a model's context: top-k neighbours per unit. */
export function neighbourSummary(ids, textEmb, imgEmb, k = 3) {
  return ids.map((id) => {
    const sims = ids.filter((o) => o !== id).map((o) => ({
      o, t: cosine(textEmb[id] || [], textEmb[o] || []), i: cosine(imgEmb[id] || [], imgEmb[o] || []),
    }));
    const top = (key) => [...sims].sort((a, b) => b[key] - a[key]).slice(0, k).map((s) => `${s.o}(${s[key].toFixed(2)})`).join(', ');
    return `${id}: text-similar ${top('t')}; image-similar ${top('i')}`;
  }).join('\n');
}
