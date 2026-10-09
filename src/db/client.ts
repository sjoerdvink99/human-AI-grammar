import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const databasePath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "repository.db");

function connect() {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

const globalForDb = globalThis as unknown as { db?: ReturnType<typeof connect> };

export const db = globalForDb.db ?? connect();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
