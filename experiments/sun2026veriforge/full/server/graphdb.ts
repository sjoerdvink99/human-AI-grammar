// tool_1: graph database. Stores entities, relations and their source passages,
// composes the knowledge graph (P1), matches vectors against it (P3, P5) and finds
// related edges between canvas nodes (P6).
import fs from "node:fs";
import path from "node:path";
import { cosine, embed } from "./embed.ts";
import type {
  CanvasEdge, DomainEntity, DomainRelation, Fact, GraphEntity, GraphRelation, GraphStats, Passage, SourceDocument,
} from "../shared/types.ts";

export function normKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, " ").trim().replace(/s$/, "");
}

interface Store {
  documents: SourceDocument[];
  passages: Record<string, Passage>;
  entities: Record<string, GraphEntity>;
  relations: GraphRelation[];
}

/** Return an exact quote from the passage: the evidence if it occurs verbatim, otherwise the sentence mentioning `name`. */
export function exactQuote(passage: Passage, evidence: string, name: string): string {
  const ev = evidence.trim();
  if (ev && passage.text.includes(ev)) return ev;
  const sentences = passage.text.match(/[^.!?\n]+[.!?]?/g) ?? [passage.text];
  const lower = name.toLowerCase();
  const hit = sentences.find((s) => s.toLowerCase().includes(lower));
  return (hit ?? sentences[0] ?? passage.text.slice(0, 300)).trim();
}

export class GraphDB {
  private store: Store = { documents: [], passages: {}, entities: {}, relations: [] };
  constructor(private file?: string) {
    if (file && fs.existsSync(file)) this.store = JSON.parse(fs.readFileSync(file, "utf8"));
  }

  private save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.store));
  }

  addDocument(doc: SourceDocument, passages: Passage[]) {
    this.store.documents.push(doc);
    for (const p of passages) this.store.passages[p.id] = p;
    this.save();
  }

  passage(id: string): Passage | undefined {
    return this.store.passages[id];
  }

  stats(): GraphStats {
    return {
      documents: this.store.documents,
      entityCount: Object.keys(this.store.entities).length,
      relationCount: this.store.relations.length,
      passageCount: Object.keys(this.store.passages).length,
    };
  }

  clear() {
    this.store = { documents: [], passages: {}, entities: {}, relations: [] };
    this.save();
  }

  /** [tool_1 compose]: domain_entities* + domain_relations* -> knowledge_graph */
  async compose(entities: DomainEntity[], relations: DomainRelation[]) {
    const touched = new Set<string>();
    for (const e of entities) {
      const key = normKey(e.name);
      if (!key || !this.store.passages[e.passageId]) continue;
      const passage = this.store.passages[e.passageId];
      const node = (this.store.entities[key] ??= { key, name: e.name, type: e.type, descriptions: [], vector: [] });
      if (!node.descriptions.some((d) => d.text === e.description)) {
        node.descriptions.push({ text: e.description, passageId: e.passageId, evidence: exactQuote(passage, e.evidence, e.name) });
      }
      touched.add(key);
    }
    for (const r of relations) {
      const s = normKey(r.source), t = normKey(r.target);
      const passage = this.store.passages[r.passageId];
      if (!passage || !s || !t || s === t) continue;
      for (const [k, n] of [[s, r.source], [t, r.target]] as const) {
        if (!this.store.entities[k]) {
          this.store.entities[k] = { key: k, name: n, type: "concept", descriptions: [], vector: [] };
          touched.add(k);
        }
      }
      if (this.store.relations.some((x) => x.source === s && x.target === t && x.label === r.label)) continue;
      this.store.relations.push({ source: s, target: t, label: r.label, passageId: r.passageId, evidence: exactQuote(passage, r.evidence, r.source) });
    }
    const keys = [...touched];
    const vectors = await embed(keys.map((k) => this.entityText(this.store.entities[k]))); // model_2 at ingestion
    keys.forEach((k, i) => (this.store.entities[k].vector = vectors[i]));
    this.save();
  }

  private entityText(e: GraphEntity) {
    return `${e.name} ${e.name} ${e.type} ${e.descriptions[0]?.text ?? ""}`;
  }

  private neighbors(key: string) {
    return this.store.relations.filter((r) => r.source === key || r.target === key);
  }

  /**
   * [tool_1 match]: vectors* + knowledge_graph -> facts*.
   * Seeds by cosine similarity (plus exact-name bonus), then walks `hops` relation hops.
   */
  match(concepts: { key: string; text: string; vector: number[] }[], hops: number, perConcept = 3, threshold = 0.32): Fact[] {
    const facts: Fact[] = [];
    const seen = new Set<string>();
    const ents = Object.values(this.store.entities);
    for (const c of concepts) {
      const cNorm = normKey(c.text);
      const scored = ents
        .map((e) => {
          let s = cosine(c.vector, e.vector);
          if (e.key === cNorm) s += 0.5;
          else if (cNorm && (e.key.includes(cNorm) || cNorm.includes(e.key)) && e.key.length > 3) s += 0.2;
          return { e, s };
        })
        .filter((x) => x.s >= threshold)
        .sort((a, b) => b.s - a.s)
        .slice(0, perConcept);
      let frontier = scored.map((x) => ({ key: x.e.key, score: x.s }));
      for (const { e, s } of scored) {
        for (const d of e.descriptions.slice(0, 2)) {
          const id = `${c.key}|d|${e.key}|${d.passageId}|${d.text.slice(0, 30)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const p = this.store.passages[d.passageId];
          facts.push({ id, conceptKey: c.key, entity: e.name, statement: d.text, passageId: d.passageId, quote: d.evidence, docTitle: p?.docTitle ?? "", score: s, hop: 0 });
        }
      }
      const visited = new Set(frontier.map((f) => f.key));
      for (let hop = 1; hop <= hops; hop++) {
        const next: { key: string; score: number }[] = [];
        for (const f of frontier) {
          for (const r of this.neighbors(f.key).slice(0, 6)) {
            const id = `${c.key}|r|${r.source}|${r.label}|${r.target}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const src = this.store.entities[r.source], tgt = this.store.entities[r.target];
            const p = this.store.passages[r.passageId];
            const score = f.score * Math.pow(0.8, hop);
            facts.push({
              id, conceptKey: c.key, entity: f.key === r.source ? src.name : tgt.name,
              statement: `${src.name} ${r.label} ${tgt.name}`,
              relation: { source: src.name, label: r.label, target: tgt.name },
              passageId: r.passageId, quote: r.evidence, docTitle: p?.docTitle ?? "", score, hop,
            });
            const other = f.key === r.source ? r.target : r.source;
            if (!visited.has(other)) { visited.add(other); next.push({ key: other, score }); }
          }
        }
        frontier = next;
      }
    }
    return facts.sort((a, b) => b.score - a.score);
  }

  entityByKey(key: string) {
    return this.store.entities[key];
  }

  /** [tool_1 match] on the canvas: canvas nodes -> related_edges (labeled). */
  async relateNodes(nodes: { id: string; concept: string; entityKeys: string[] }[]): Promise<CanvasEdge[]> {
    const edges: CanvasEdge[] = [];
    const vecs = await embed(nodes.map((n) => n.concept));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const A = new Set(a.entityKeys), B = new Set(b.entityKeys);
        let label: string | null = null;
        const direct = this.store.relations.find((r) => (A.has(r.source) && B.has(r.target)) || (B.has(r.source) && A.has(r.target)));
        if (direct) {
          // keep the relation's direction: the edge points from the source entity's node
          if (!A.has(direct.source)) {
            edges.push({ id: `auto-${b.id}-${a.id}`, source: b.id, target: a.id, label: direct.label, auto: true });
            continue;
          }
          label = direct.label;
        } else {
          const shared = [...A].filter((k) => B.has(k));
          if (shared.length) label = `both about ${this.store.entities[shared[0]]?.name ?? shared[0]}`;
          else {
            const nA = new Set(a.entityKeys.flatMap((k) => this.neighbors(k).map((r) => (r.source === k ? r.target : r.source))));
            const via = b.entityKeys.find((k) => nA.has(k)) ?? [...nA].find((k) => b.entityKeys.some((bk) => this.neighbors(bk).some((r) => r.source === k || r.target === k)));
            if (via) label = `linked via ${this.store.entities[via]?.name ?? via}`;
            else if (cosine(vecs[i], vecs[j]) > 0.5) label = "similar topic";
          }
        }
        if (label) edges.push({ id: `auto-${a.id}-${b.id}`, source: a.id, target: b.id, label, auto: true });
      }
    }
    return edges;
  }
}
