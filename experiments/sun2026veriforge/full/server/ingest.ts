// Process 1 — Build Domain Knowledge Graph
// (source_documents_1)* -> [model_1 extract] -> (domain_entities_1)* + (domain_relations_1)* -> [tool_1 compose] -> (knowledge_graph_1)
import { randomUUID } from "node:crypto";
import { callModel } from "./model.ts";
import type { GraphDB } from "./graphdb.ts";
import type { DomainEntity, DomainRelation, IngestJob, Passage, SourceDocument } from "../shared/types.ts";

const PASSAGE_CHARS = 2500;
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 4);

/** tool: split a document into passages on paragraph boundaries. */
export function splitPassages(docId: string, docTitle: string, text: string): Passage[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: Passage[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push({ id: `${docId}:${out.length}`, docId, docTitle, index: out.length, text: buf.trim() });
    buf = "";
  };
  for (const p of paras) {
    if (p.length > PASSAGE_CHARS) {
      flush();
      const sentences = p.match(/[^.!?]+[.!?]+["')\]]?\s*|[^.!?]+$/g) ?? [p];
      for (const s of sentences) {
        if ((buf + s).length > PASSAGE_CHARS) flush();
        buf += s;
      }
      flush();
    } else {
      if ((buf + "\n\n" + p).length > PASSAGE_CHARS) flush();
      buf += (buf ? "\n\n" : "") + p;
    }
  }
  flush();
  return out;
}

const EXTRACT_SYSTEM = `You build a domain knowledge graph from reference texts used by fiction writers.
Extract the domain entities (people, places, objects, techniques, institutions, events, terms of art) and the relationships between them that a novelist might need to understand.
Rules:
- Use only information stated in the passage.
- "description" is one factual sentence about the entity, based on the passage.
- "evidence" MUST be copied verbatim (exact characters) from the passage: the shortest full sentence that supports the item.
- Relation "label" is a short lowercase verb phrase (e.g. "is part of", "was invented by").
- Relation source/target must be names of extracted entities.
- Return at most 15 entities and 15 relations.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, type: { type: "string" }, description: { type: "string" }, evidence: { type: "string" } },
        required: ["name", "type", "description", "evidence"],
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: { source: { type: "string" }, target: { type: "string" }, label: { type: "string" }, evidence: { type: "string" } },
        required: ["source", "target", "label", "evidence"],
      },
    },
  },
  required: ["entities", "relations"],
};

/** [model_1 extract]: passage -> domain_entities* + domain_relations* */
export async function extractEntities(passage: Passage): Promise<{ entities: DomainEntity[]; relations: DomainRelation[] }> {
  const out = await callModel<{ entities: Omit<DomainEntity, "passageId">[]; relations: Omit<DomainRelation, "passageId">[] }>({
    op: "extract entities",
    system: EXTRACT_SYSTEM,
    prompt: `Source: "${passage.docTitle}", passage ${passage.index + 1}\n\n<passage>\n${passage.text}\n</passage>`,
    schema: EXTRACT_SCHEMA,
  });
  // validate: drop empty names, keep relations whose endpoints are known entities
  const entities = (out.entities ?? []).filter((e) => e.name?.trim()).map((e) => ({ ...e, passageId: passage.id }));
  const names = new Set(entities.map((e) => e.name.toLowerCase()));
  const relations = (out.relations ?? [])
    .filter((r) => r.label?.trim() && names.has(r.source?.toLowerCase()) && names.has(r.target?.toLowerCase()))
    .map((r) => ({ ...r, passageId: passage.id }));
  return { entities, relations };
}

export const jobs = new Map<string, IngestJob>();

export function startIngest(db: GraphDB, files: { title: string; text: string }[]): IngestJob {
  const job: IngestJob = { id: randomUUID(), status: "running", total: 0, done: 0, message: "Splitting documents" };
  jobs.set(job.id, job);
  const passages: Passage[] = [];
  for (const f of files) {
    const docId = randomUUID().slice(0, 8);
    const ps = splitPassages(docId, f.title, f.text);
    const doc: SourceDocument = { id: docId, title: f.title, charCount: f.text.length, passageIds: ps.map((p) => p.id) };
    db.addDocument(doc, ps);
    passages.push(...ps);
  }
  job.total = passages.length;
  job.message = "Extracting entities and relations";
  (async () => {
    let next = 0;
    const errors: string[] = [];
    const worker = async () => {
      while (next < passages.length) {
        const p = passages[next++];
        try {
          const { entities, relations } = await extractEntities(p);
          await db.compose(entities, relations); // [tool_1 compose]
        } catch (e) {
          errors.push(String(e));
        }
        job.done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, passages.length) }, worker));
    job.status = errors.length === passages.length && passages.length ? "error" : "done";
    job.message = errors.length ? `${errors.length} passage(s) failed: ${errors[0]}` : "Knowledge graph ready";
  })();
  return job;
}
