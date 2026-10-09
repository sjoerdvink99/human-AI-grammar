// Deterministic tool steps (tool_1 … tool_4).

/** tool_1 extract: annotation records (r2) -> regions (r3) + object labels (r4). */
export function tool1Extract(images, annotations) {
  const regions = [];
  const objectLabels = [];
  for (const img of images) {
    const ann = annotations.find((a) => a.imageId === img.id);
    (ann?.objects || []).forEach((o, i) => {
      if (!Array.isArray(o.bbox) || o.bbox.length !== 4 || !o.label) return;
      const id = `${img.id}#${i}`;
      const [x, y, w, h] = o.bbox.map(Number);
      regions.push({ id, imageId: img.id, bbox: [x, y, w, h] });
      objectLabels.push({ regionId: id, label: String(o.label).toLowerCase().trim() });
    });
  }
  return { regions, objectLabels };
}

// --- tool_2 / tool_3 translate: text -> numeric vectors (hashed bag of words) ---
const DIM = 256;
const STOP = new Set('a an the of and or to in on at with is are be for by this that it its as from there their image scene'.split(' '));

export function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''))) || [];
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function embed(text) {
  const v = new Array(DIM).fill(0);
  for (const t of tokenize(text)) v[hash(t) % DIM] += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => +(x / n).toFixed(5));
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** tool_2 translate: captions (r5) -> caption vectors (r13). */
export function tool2EmbedCaptions(captions) {
  return captions.map((c) => ({ imageId: c.imageId, vector: embed(c.text) }));
}

/** tool_3 translate: active guidelines (r12) -> guideline vectors (r14). */
export function tool3EmbedGuidelines(guidelines) {
  return guidelines.map((g) => ({ guidelineId: g.id, vector: embed(`${g.name} ${g.rule}`) }));
}

/** Similarity of each image to each guideline, used to build model_3's prompt. */
export function similarities(captionVectors, guidelineVectors) {
  return captionVectors.map((c) => ({
    imageId: c.imageId,
    scores: guidelineVectors.map((g) => ({ guidelineId: g.guidelineId, sim: +cosine(c.vector, g.vector).toFixed(3) }))
      .sort((a, b) => b.sim - a.sim),
  }));
}

/** tool_4 extract: human reviews (r23) + final labels (r24) -> labeled examples (r25). */
export function tool4Extract(state, imageIds) {
  const examples = [...state.labeledExamples];
  for (const imageId of imageIds) {
    const label = state.finalLabels.find((l) => l.imageId === imageId)?.label;
    if (!label) continue;
    const review = [...state.humanReviews].reverse().find((r) => r.imageId === imageId);
    const ex = {
      imageId,
      label,
      concept: state.conceptLabels.find((c) => c.imageId === imageId)?.conceptId || null,
      caption: state.captions.find((c) => c.imageId === imageId)?.text || '',
      rationale: state.rationales.find((r) => r.imageId === imageId)?.text || '',
      modelLabel: state.taskLabels.current.find((l) => l.imageId === imageId)?.label || null,
      verdict: review?.verdict || null,
      comment: review?.comment || '',
      dialogue: examples.find((e) => e.imageId === imageId)?.dialogue || [],
    };
    const i = examples.findIndex((e) => e.imageId === imageId);
    if (i >= 0) examples[i] = ex; else examples.push(ex);
  }
  return examples;
}

/** tool_4 expand: add the Q&A (r28, r29) and updated label (r24_2) to the labeled examples (r25_2). */
export function tool4Expand(state, imageId) {
  const base = tool4Extract(state, [imageId]);
  const ex = base.find((e) => e.imageId === imageId);
  if (ex && state.assistantReply?.imageId === imageId) {
    ex.dialogue = [...(ex.dialogue || []), {
      question: state.assistantReply.question,
      answer: state.assistantReply.text,
      suggestedLabel: state.assistantReply.suggestedLabel,
      helpful: state.replyReview?.helpful ?? null,
      feedback: state.replyReview?.comment || '',
    }];
  }
  return base;
}

// --- validation helpers for generative outputs ---
export function oneOf(value, allowed, fallback) {
  const v = String(value ?? '').trim();
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (hit) return hit;
  if (fallback !== undefined) return fallback;
  throw new Error(`"${v}" not in [${allowed.join(', ')}]`);
}

export function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${x}`);
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

/** Ensure a model array covers exactly the given image ids. */
export function byImage(arr, imageIds, mapItem) {
  if (!Array.isArray(arr)) throw new Error('expected an array');
  const out = [];
  for (const id of imageIds) {
    const item = arr.find((x) => x && x.imageId === id);
    if (!item) throw new Error(`missing imageId ${id}`);
    out.push({ imageId: id, ...mapItem(item) });
  }
  return out;
}
