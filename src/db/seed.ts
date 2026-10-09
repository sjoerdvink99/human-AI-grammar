import { systemInputSchema } from "@/domain/systems/schema";
import { listSystems, replaceCorpus } from "./queries";
import { seedSystems } from "./seed-data";

const existing = listSystems().length;

if (existing > 0 && !process.argv.includes("--reset")) {
  console.log(`Repository already contains ${existing} systems. Run npm run db:reset to replace them with seed data.`);
  process.exit(0);
}

replaceCorpus(seedSystems.map((record) => systemInputSchema.parse(record)));
console.log(`Seeded ${seedSystems.length} systems.`);
