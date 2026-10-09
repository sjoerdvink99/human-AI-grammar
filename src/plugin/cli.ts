import { readFileSync } from "node:fs";
import { z } from "zod";
import corpus from "../../corpus/systems.json";
import { connections } from "@/domain/design/connections";
import { corpusSteps, nextSteps, searchSteps, similarSystems, stepText } from "@/domain/design/inspiration";
import { decodeSpec, designParam, encodeSpec, type DesignSpec } from "@/domain/design/spec";
import { formatProcess } from "@/domain/grammar/formatter";
import { parseProcess } from "@/domain/grammar/parser";
import type { ParseError, ParseResult, Process } from "@/domain/grammar/types";
import { suggestedVocabulary, vocabularyTypes, type VocabularyType } from "@/domain/grammar/vocabulary";
import { buildEntry, recordFromInput } from "@/domain/systems/corpus";
import { systemInputSchema, systemRecordSchema } from "@/domain/systems/schema";
import type { SystemEntry } from "@/domain/systems/types";
import { buildVocabulary, termsOfType } from "@/domain/systems/vocabulary";
import { formatScore, plural, shortAuthors } from "@/lib/format";

const site = (process.env.HUMAN_AI_SITE ?? "https://sjoerdvink99.github.io/human-AI-grammar").replace(/\/$/, "");

const entries: SystemEntry[] = z
  .array(systemInputSchema)
  .parse(corpus)
  .map((input, index) => buildEntry(recordFromInput(input, index + 1)));

const vocabulary = buildVocabulary(entries);

const known = Object.fromEntries(
  vocabularyTypes.map((type) => [type, new Set([...suggestedVocabulary[type], ...termsOfType(vocabulary, type)])]),
) as Record<VocabularyType, Set<string>>;

const usage = `human-ai — tools for the Human-AI grammar (${entries.length} systems in the bundled corpus)

  human-ai parse [expression]       validate one expression (reads stdin when omitted)
  human-ai check <file.json>        validate an extracted system record, or an array of records
  human-ai design <link|file|json>  decode a design from the website
  human-ai link <file.json>         encode a design spec or system record as a website design link
  human-ai search <terms...>        corpus steps matching all terms
  human-ai next <expression>        corpus steps that start from the expression's last state
  human-ai similar <expression>     corpus systems most similar to the expression
  human-ai show <key|name>          a corpus system with its paper and processes
  human-ai vocab                    observed roles, media, and operations with system counts`;

const cite = (entry: SystemEntry) =>
  `${entry.name} — ${shortAuthors(entry.paper.authors)}, ${entry.paper.venue} ${entry.paper.year} [${entry.paper.citationKey}]`;

const indent = (text: string, prefix = "  ") =>
  text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");

function caret(source: string, error: ParseError): string {
  const line = source.split("\n")[error.line - 1] ?? "";
  return `${error.line}:${error.column} ${error.message}\n${line}\n${" ".repeat(error.column - 1)}${"^".repeat(Math.max(1, Math.min(error.length, line.length - error.column + 1)))}`;
}

function newTerms(process: Process): string[] {
  const representations = process.states.flatMap((state) => state.representations);
  const terms: Record<VocabularyType, string[]> = {
    role: representations.map((representation) => representation.role),
    medium: representations.map((representation) => representation.medium),
    operation: process.transforms.map((transform) => transform.operation),
  };
  return vocabularyTypes.flatMap((type) => [...new Set(terms[type])].filter((term) => !known[type].has(term)).map((term) => `${type} ${term}`));
}

function describe(source: string, result: ParseResult): string {
  if (!result.ok) return indent(caret(source, result.error));
  const fresh = newTerms(result.process);
  return [
    indent(formatProcess(result.process)),
    `  ${plural(result.process.states.length, "state")}, ${plural(result.process.transforms.length, "transformation")}`,
    ...(fresh.length ? [`  new vocabulary: ${fresh.join(", ")}`] : []),
  ].join("\n");
}

function readSource(argument: string | undefined): string {
  if (argument === undefined || argument === "-") return readFileSync(0, "utf8");
  try {
    return readFileSync(argument, "utf8");
  } catch {
    return argument;
  }
}

function requireProcess(source: string): Process {
  const result = parseProcess(source);
  if (!result.ok) fail(caret(source, result.error));
  return result.process;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parse(args: string[]) {
  const source = args.length > 1 ? args.join(" ") : readSource(args[0]);
  const result = parseProcess(source);
  console.log(result.ok ? "ok" : "error");
  console.log(describe(source, result));
  if (!result.ok) process.exit(1);
}

function check([file]: string[]) {
  if (!file) fail("Usage: human-ai check <file.json>");
  let json: unknown;
  try {
    json = JSON.parse(readSource(file));
  } catch (error) {
    fail(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const records = Array.isArray(json) ? json : [json];
  const keys = new Set(entries.map((entry) => entry.paper.citationKey));
  let failed = false;
  records.forEach((record, index) => {
    const result = systemRecordSchema.safeParse(record);
    const label = records.length > 1 ? `record ${index + 1}` : "record";
    if (!result.success) {
      failed = true;
      console.log(`${label}: invalid`);
      result.error.issues.forEach((issue) => console.log(`  ${issue.path.join(".") || "record"}: ${issue.message}`));
      return;
    }
    const { paper, system, processes } = result.data;
    const parsed = processes.map((item) => ({ ...item, result: parseProcess(item.rawExpression) }));
    const invalid = parsed.filter((item) => !item.result.ok).length;
    failed ||= invalid > 0;
    console.log(`${label}: ${system.name} [${paper.citationKey}] ${invalid ? `${invalid} invalid processes` : "ok"}`);
    if (keys.has(paper.citationKey)) console.log(`  note: citation key ${paper.citationKey} already exists in the corpus`);
    parsed.forEach((item, position) => {
      console.log(`process ${position + 1}${item.name ? ` (${item.name})` : ""}`);
      console.log(describe(item.rawExpression, item.result));
    });
  });
  if (failed) process.exit(1);
}

function specFromRecord(source: string): DesignSpec | null {
  try {
    const record = systemRecordSchema.safeParse(JSON.parse(source));
    if (!record.success) return null;
    return {
      name: record.data.system.name,
      goal: record.data.system.description,
      processes: record.data.processes,
      representations: {},
      references: [record.data.paper.citationKey],
    };
  } catch {
    return null;
  }
}

function readSpec(argument: string | undefined, usage: string): DesignSpec {
  if (!argument) fail(usage);
  const source = readSource(argument);
  const spec = specFromRecord(source) ?? decodeSpec(source);
  if (!spec) fail("Not a design link, design spec, or system record.");
  return spec;
}

function design([argument]: string[]) {
  const spec = readSpec(argument, "Usage: human-ai design <link|file|json>");
  console.log(`name: ${spec.name || "(untitled)"}`);
  console.log(`goal: ${spec.goal || "(none)"}`);
  const results = spec.processes.map((item) => parseProcess(item.rawExpression));
  spec.processes.forEach((item, index) => {
    console.log(`\nprocess ${index + 1}${item.name ? ` (${item.name})` : ""}`);
    if (item.note) console.log(`  when: ${item.note}`);
    console.log(describe(item.rawExpression, results[index]));
  });
  const described = Object.entries(spec.representations);
  if (described.length) {
    console.log("\nrepresentations");
    described.forEach(([name, description]) => console.log(`  ${name}: ${description}`));
  }
  const label = (index: number) => `process ${index + 1}${spec.processes[index].name ? ` (${spec.processes[index].name})` : ""}`;
  const links = connections(results.map((result) => (result.ok ? result.process : null)));
  if (links.length) {
    console.log("\nconnections");
    links.forEach((link) =>
      console.log(
        link.kind === "continues"
          ? `  ${label(link.to)} continues from ${label(link.from)} through ${link.via.join(", ")}`
          : `  ${label(link.from)} and ${label(link.to)} both work with ${link.via.join(", ")}`,
      ),
    );
  }
  if (spec.references.length) {
    console.log("\nreferences");
    spec.references.forEach((key) => {
      const entry = entries.find((candidate) => candidate.paper.citationKey === key);
      console.log(`  ${entry ? cite(entry) : `${key} (not in the bundled corpus)`}`);
    });
  }
  console.log(`\njson\n${JSON.stringify(spec, null, 2)}`);
}

function link([argument]: string[]) {
  const spec = readSpec(argument, "Usage: human-ai link <file.json>");
  console.log(`${site}/design/?${designParam}=${encodeSpec(spec)}`);
}

function printSteps(steps: ReturnType<typeof corpusSteps>) {
  if (steps.length === 0) console.log("no steps");
  steps.forEach((step) => {
    console.log(stepText(step));
    console.log(`  ${cite(step.entry)}${step.processName ? ` · ${step.processName}` : ""}`);
  });
}

function search(args: string[]) {
  if (args.length === 0) fail("Usage: human-ai search <terms...>");
  printSteps(searchSteps(entries, args.join(" "), 40));
}

function next(args: string[]) {
  const process = requireProcess(args.length > 1 ? args.join(" ") : readSource(args[0]));
  printSteps(nextSteps(entries, process.states[process.states.length - 1], 12));
}

function similar(args: string[]) {
  const process = requireProcess(args.length > 1 ? args.join(" ") : readSource(args[0]));
  similarSystems(entries, [process], 8).forEach(({ entry, similarity }) =>
    console.log(
      `${formatScore(similarity.overall)}  ${cite(entry)}  (representation ${formatScore(similarity.representation)}, transformation ${formatScore(similarity.transformation)})`,
    ),
  );
}

function show(args: string[]) {
  const query = args.join(" ").toLowerCase();
  if (!query) fail("Usage: human-ai show <key|name>");
  const entry =
    entries.find((candidate) => candidate.paper.citationKey.toLowerCase() === query) ??
    entries.find((candidate) => candidate.name.toLowerCase() === query) ??
    entries.find((candidate) => candidate.searchText.includes(query));
  if (!entry) fail(`No system matches "${query}".`);
  const { paper } = entry;
  console.log(cite(entry));
  console.log(paper.title);
  if (paper.doi) console.log(`https://doi.org/${paper.doi}`);
  else if (paper.url) console.log(paper.url);
  if (entry.description) console.log(`\n${entry.description}`);
  if (entry.processScope) console.log(`scope: ${entry.processScope}`);
  if (entry.notes) console.log(`notes: ${entry.notes}`);
  if (paper.abstract) console.log(`\nabstract\n${indent(paper.abstract)}`);
  entry.processes.forEach((item, index) => {
    console.log(`\nprocess ${index + 1}${item.name ? ` (${item.name})` : ""}`);
    console.log(describe(item.rawExpression, item.result));
  });
}

function vocab() {
  vocabularyTypes.forEach((type) => {
    console.log(`${type}`);
    const observed = vocabulary.filter((term) => term.type === type);
    const unseen = suggestedVocabulary[type].filter((term) => !observed.some((item) => item.term === term));
    observed.forEach((term) => console.log(`  ${term.term.padEnd(16)} ${term.systemCount}`));
    unseen.forEach((term) => console.log(`  ${term.padEnd(16)} 0`));
  });
}

const commands: Record<string, (args: string[]) => void> = { parse, check, design, link, search, next, similar, show, vocab };

const [command, ...args] = process.argv.slice(2);
const run = command ? commands[command] : undefined;
if (!run) {
  console.log(usage);
  process.exit(command && command !== "help" ? 1 : 0);
}
run(args);
