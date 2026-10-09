import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const papers = sqliteTable("papers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  authors: text("authors", { mode: "json" }).$type<string[]>().notNull(),
  year: integer("year").notNull(),
  venue: text("venue").notNull(),
  citationKey: text("citation_key").notNull().unique(),
  doi: text("doi"),
  url: text("url"),
  abstract: text("abstract"),
  notes: text("notes"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const systems = sqliteTable("systems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paperId: integer("paper_id")
    .notNull()
    .references(() => papers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  processScope: text("process_scope"),
  notes: text("notes"),
});

export const grammarProcesses = sqliteTable("grammar_processes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  systemId: integer("system_id")
    .notNull()
    .references(() => systems.id, { onDelete: "cascade" }),
  name: text("name"),
  description: text("description").notNull(),
  rawExpression: text("raw_expression").notNull(),
  order: integer("position").notNull(),
});

export const papersRelations = relations(papers, ({ many }) => ({
  systems: many(systems),
}));

export const systemsRelations = relations(systems, ({ one, many }) => ({
  paper: one(papers, { fields: [systems.paperId], references: [papers.id] }),
  processes: many(grammarProcesses),
}));

export const grammarProcessesRelations = relations(grammarProcesses, ({ one }) => ({
  system: one(systems, { fields: [grammarProcesses.systemId], references: [systems.id] }),
}));
