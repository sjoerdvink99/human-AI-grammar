import { asc, eq } from "drizzle-orm";
import type { SystemInput } from "@/domain/systems/schema";
import type { SystemRecord } from "@/domain/systems/types";
import { db } from "./client";
import { grammarProcesses, papers, systems } from "./schema";

const withRelations = {
  paper: true,
  processes: { orderBy: asc(grammarProcesses.order) },
} as const;

export function listSystems(): SystemRecord[] {
  return db.query.systems.findMany({ with: withRelations, orderBy: asc(systems.name) }).sync();
}

export function getSystem(id: number): SystemRecord | undefined {
  return db.query.systems.findFirst({ where: eq(systems.id, id), with: withRelations }).sync();
}

const nullable = (value: string | undefined) => value ?? null;

export function saveSystem(input: SystemInput, systemId?: number): number {
  return db.transaction((tx) => {
    const now = new Date();
    const paperValues = {
      ...input.paper,
      doi: nullable(input.paper.doi),
      url: nullable(input.paper.url),
      abstract: nullable(input.paper.abstract),
      notes: nullable(input.paper.notes),
      updatedAt: now,
    };
    const systemValues = {
      name: input.system.name,
      description: input.system.description,
      processScope: nullable(input.system.processScope),
      notes: nullable(input.system.notes),
      actors: input.system.actors,
    };

    const existing = systemId ? tx.select().from(systems).where(eq(systems.id, systemId)).get() : undefined;
    if (systemId && !existing) throw new Error(`System ${systemId} does not exist`);

    const paperId = existing
      ? tx.update(papers).set(paperValues).where(eq(papers.id, existing.paperId)).returning().get().id
      : tx
          .insert(papers)
          .values({ ...paperValues, createdAt: now })
          .onConflictDoUpdate({ target: papers.citationKey, set: paperValues })
          .returning()
          .get().id;

    const id = existing
      ? tx.update(systems).set(systemValues).where(eq(systems.id, existing.id)).returning().get().id
      : tx
          .insert(systems)
          .values({ ...systemValues, paperId })
          .returning()
          .get().id;

    tx.delete(grammarProcesses).where(eq(grammarProcesses.systemId, id)).run();
    tx.insert(grammarProcesses)
      .values(
        input.processes.map((process, order) => ({
          systemId: id,
          name: nullable(process.name),
          description: process.description,
          rawExpression: process.rawExpression,
          order,
        })),
      )
      .run();

    return id;
  });
}

export function replaceCorpus(inputs: SystemInput[]): void {
  db.delete(papers).run();
  inputs.forEach((input) => saveSystem(input));
}
