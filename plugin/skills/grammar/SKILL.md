---
name: grammar
description: Reference for the Human-AI grammar, a notation that describes Human-AI systems as processes of typed representations and transformations, written like (prompt_1: instruction language) -> [model generate]~ -> (draft_1: artifact language). Use whenever reading, writing, validating, or explaining such expressions, or when the user mentions the Human-AI grammar.
---

# Human-AI grammar

```text
process   ::= state (-> transform -> state)+
state     ::= rep (+ rep)*
rep       ::= ( id : role medium )
transform ::= [ actor operation ] ~?
actor     ::= human | model | tool        optionally with an instance suffix: model_1, human_2
role      ::= instruction | artifact | selection | label | evaluation | …
medium    ::= language | visual | spatial | structured | formal | audio | …
operation ::= generate | modify | select | specify | translate | expand | extract | decompose
            | compose | match | evaluate | execute | delegate | assign | configure | …
```

## Meaning

- A **representation** `(id: role medium)` is a typed piece of information. The role says what it is for, the medium says how it is encoded.
- A **state** is the set of representations present together at one point in the process. `a + b` means both are available at once.
- A **transformation** `[actor operation]` turns one state into the next. Humans act through an interface, models are learned or generative components, tools are deterministic code.
- `~` marks a stochastic transformation: the same input can produce different outputs.
- The **identifier** carries identity and version. `draft_1` appearing in two states is the same unchanged information. `draft_1` becoming `draft_2` is a change to that information.
- Distinct interaction modes or branches are separate processes. A loop is written as one iteration.
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
| visual | images, renderings, charts |
| spatial | positions, regions, layouts, coordinates |
| structured | schema'd data: JSON, tables, graphs, trees |
| formal | code, queries, logic, DSLs |
| audio | speech and sound |

## Syntax constraints

- Actors are exactly `human`, `model`, or `tool`, optionally suffixed (`model_1`). Never `user`, `llm`, `agent`, or `system`.
- `~` follows the closing bracket: `[model generate]~`.
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
