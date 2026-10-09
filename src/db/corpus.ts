import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { recordToInput } from "@/domain/systems/corpus";
import { systemInputSchema } from "@/domain/systems/schema";
import { listSystems, replaceCorpus } from "./queries";

const [command, file = "corpus/systems.json"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (command === "export") {
  const records = listSystems().map(recordToInput);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`);
  console.log(`Exported ${records.length} systems to ${file}.`);
} else if (command === "import") {
  const existing = listSystems().length;
  if (existing > 0 && !process.argv.includes("--replace")) {
    console.error(`Repository already contains ${existing} systems. Pass --replace to overwrite them with ${file}.`);
    process.exit(1);
  }
  const records = z.array(systemInputSchema).parse(JSON.parse(readFileSync(file, "utf8")));
  replaceCorpus(records);
  console.log(`Imported ${records.length} systems from ${file}.`);
} else {
  console.error("Usage: tsx src/db/corpus.ts <export|import> [file] [--replace]");
  process.exit(1);
}
