---
name: grammar
description: Reference for the Human-AI grammar, a notation that describes Human-AI systems as processes of typed representations and transformations, written like (prompt_1: instruction language) -> [model generate]~ -> (drafts_1: artifact language)*. Use whenever reading, writing, validating, or explaining such expressions, or when the user mentions the Human-AI grammar.
---

# Human-AI grammar

```text
process   ::= state (-> transform -> state)+
state     ::= rep (+ rep)*
rep       ::= ( id : role medium ) *?
transform ::= [ actor operation ] ~?
actor     ::= human | model | tool        optionally with an instance suffix: model_1, human_2
role      ::= instruction | artifact | selection | label | evaluation | …
medium    ::= language | visual | spatial | record | tabular | graph | numeric | categorical | formal | audio | …
operation ::= generate | modify | select | specify | translate | expand | extract | decompose
            | compose | match | evaluate | execute | delegate | assign | configure | …
```

## Meaning

- A **representation** `(id: role medium)` is a typed piece of information. The role says what it is for, the medium says how it is encoded.
- A **state** is the set of representations present together at one point in the process. `a + b` means both are available at once.
- A **transformation** `[actor operation]` turns one state into the next. Humans act through an interface, models are learned components, tools are deterministic code.
- A process **starts** from the representations it begins with: a prompt the user writes, an uploaded file, or another process's output.
- `~` after a transformation marks it as **generative**: a model creates new content, so the same input can give different outputs. Classifying, embedding, or scoring models, tools, and humans are not generative.
- `*` after a representation marks a **collection**: many items of the same kind, such as candidates to choose from, `(images_1: artifact visual)*`. Selecting one yields a representation without `*`.
- The **identifier** carries identity and version. `draft_1` appearing in two states in a row is the same unchanged information. `draft_1` becoming `draft_2` is a change to that information.
- A step that ends in an earlier state, with exactly the same identifiers, goes **back to that state**: a **loop**. `(prompt_1: …) -> [model generate]~ -> (image_1: …) -> [human modify] -> (prompt_1: …)` repeats generation with a rewritten prompt. The step that closes a round keeps the earlier versions, and no other step may end in an earlier state. The process description says when the loop stops.
- Distinct interaction modes or branches are separate processes.
- Vocabularies are open: prefer an existing term, introduce a new one only when none fits.

## Roles and media

| Role | Function |
| --- | --- |
| instruction | tells an actor what to do: prompts, requests, goals, constraints |
| artifact | the thing being produced or worked on |
| selection | a reference to part of something: a region, a span, chosen items |
| label | a category or annotation attached to something |
| evaluation | a judgement about something: scores, critiques, feedback, verdicts |

| Medium | Encoding |
| --- | --- |
| language | natural language text |
| visual | images, renderings, charts, video |
| spatial | positions, regions, layouts, coordinates, masks |
| record | named fields: configurations, specifications, requests, profiles, tool calls, JSON objects |
| tabular | rows and columns: datasets, tables, spreadsheets |
| graph | nodes and links: graphs, trees, hierarchies, workflows, pipelines |
| numeric | numbers and vectors: scores, metrics, weights, embeddings |
| categorical | values from a fixed set: choices, modes, categories, flags, decisions |
| formal | code, queries, logic, DSLs |
| audio | speech and sound |
| multimodal | several encodings that cannot be separated |

A list of text items is `language*`, not a record.

## Syntax constraints

- Actors are exactly `human`, `model`, or `tool`, optionally suffixed (`model_1`). Never `user`, `llm`, `agent`, or `system`.
- `~` follows the closing bracket: `[model generate]~`.
- `*` follows the closing parenthesis: `(images_1: artifact visual)*`.
- Identifiers are lowercase snake_case with a version suffix: `prompt_1`, `tool_call_2`.
- Each representation has exactly one role and one medium.
- Expressions contain no commas, quotes, comments, or prose.

## Tools

The plugin ships a CLI that uses the same parser, similarity measures, and corpus as the website. Run it with Node:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/human-ai.mjs" <command>
```

If `CLAUDE_PLUGIN_ROOT` is not set, the CLI is at `../../scripts/human-ai.mjs` relative to this skill's base directory.

| Command | Use |
| --- | --- |
| `parse "<expression>"` | validate an expression; prints the canonical form, counts, and new vocabulary, or the error with line and column |
| `check <file.json>` | validate an extracted system record or an array of records |
| `design <link\|file\|json>` | decode a design created on the website |
| `link <file.json>` | turn a design spec or system record into a website design link |
| `search <terms...>` | corpus steps matching all terms, e.g. `search model evaluate` |
| `next "<expression>"` | corpus steps that start from a state like the expression's last state |
| `similar "<expression>"` | corpus systems most similar in structure |
| `show <citation key\|name>` | a corpus system with paper metadata, abstract, and processes |
| `vocab` | observed vocabulary with the number of systems using each term |

Always validate an expression with `parse` or `check` before presenting it as final.
