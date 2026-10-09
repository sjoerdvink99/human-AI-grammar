import { existsSync } from "node:fs";
import path from "node:path";

const directory = path.join(process.cwd(), "experiments");

const repository = "https://github.com/sjoerdvink99/human-AI-grammar/tree/main/experiments";

/** What the agent received when it rebuilt the system, in the order the links are shown. */
const conditions = [
  { id: "full", label: "Full", description: "Expressions with anonymized descriptions" },
  { id: "expressions", label: "Expressions", description: "Expressions only" },
  { id: "anonymized", label: "Anonymized", description: "Expressions only, with representation names replaced" },
] as const;

export interface Regeneration {
  label: string;
  description: string;
  href: string;
}

/** Apps an agent rebuilt from this system's expressions, published in experiments/<citationKey>/<condition>/. */
export function regenerationsFor(citationKey: string): Regeneration[] {
  return conditions
    .filter(({ id }) => existsSync(path.join(directory, citationKey, id, "NOTES.md")))
    .map(({ id, label, description }) => ({ label, description, href: `${repository}/${citationKey}/${id}` }));
}
