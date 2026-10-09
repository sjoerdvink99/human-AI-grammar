---
name: extract
description: Extract Human-AI grammar expressions from one or more research papers into validated JSON system records for the Human-AI systems repository. Use when the user asks to extract, encode, or describe a paper or system with the Human-AI grammar.
argument-hint: <paper.pdf | url | doi> [more papers] [--out dir]
---

# Extract grammar expressions from papers

Papers: $ARGUMENTS

Load the `grammar` skill for the notation and the CLI. The extraction rules, examples, and output format are in [prompt.md](prompt.md), the same prompt used to build the published corpus. Read it in full before the first paper and follow it exactly, with two changes: write each record to a file instead of returning it in chat, and report evidence in chat rather than inside the record.

## For each paper

1. **Read the whole paper.** For a PDF, read every page, including figures and the system description. For a DOI or URL, fetch it; if only the abstract is reachable, say so and ask for the PDF rather than extracting from the abstract.
2. **Check for duplicates.** Run `show <likely citation key or system name>`. If the system is already in the corpus, tell the user and ask whether to re-extract.
3. **Look at the corpus for conventions.** Run `vocab`, and `search` for operations or representations the paper suggests, so terms are used the same way as in existing records.
4. **Extract** following prompt.md: reconstruct the real process, keep meaningful intermediate representations, version identifiers only when content changes, mark generative steps with `~`, give each distinct model its own instance (`model_1`, `model_2`), split distinct modes into separate named processes, and give every process a plain-language `description`.
5. **Write** the record to `<out>/<citationKey>.json`, where `<out>` is the `--out` directory, or `extractions/` when none is given.
6. **Validate** with `check <file>`. Fix every reported problem and re-run until it reports `ok`. Treat every `new vocabulary` line as a decision: keep the new term only if no existing term fits, and explain it in `system.notes`.
7. **Report** in chat: the system name, each process with its description and expression as a code block, and for every transformation a short pointer to the evidence (section, figure, or quote). List uncertain steps explicitly.

With several papers, finish and validate one before starting the next, then end with a table of file, system, process count, and new terms.

## Adding records to the repository

- In this repository, append records to `corpus/systems.json` and load them with `npm run corpus:import -- --replace`.

Do not modify the corpus unless the user asks.
