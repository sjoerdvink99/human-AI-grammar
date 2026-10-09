# A Grammar for Human-AI Systems

Sjoerd Vink

A research tool for describing, comparing, and exploring Human-AI systems through a common process grammar.

## Grammar

```
process   ::= state (-> transform -> state)+
state     ::= rep (+ rep)*
rep       ::= ( id : role medium )
transform ::= [ actor operation ] ~?
actor     ::= human | model | tool   (optionally with an instance suffix: model_1)
role      ::= instruction | artifact | selection | label | evaluation | …
medium    ::= language | visual | spatial | structured | formal | audio | …
op        ::= generate | modify | select | specify | translate | expand | extract | decompose
            | compose | match | evaluate | execute | delegate | assign | configure | …
```

```
(prompt_1: instruction language)
-> [model generate]~
-> (artifact_1: artifact language) + (region_1: selection spatial)
```

`| …` marks an open vocabulary: the listed terms are seeds, and any new term is accepted. `~` marks a stochastic transformation.

## Principles

- The raw expression is the source of truth and is stored verbatim.
- The AST is derived by the parser; expressions are validated before saving.
- Structural features are derived from the AST in one place (`domain/grammar/features.ts`).
- Vocabulary is derived from the corpus, never maintained as a closed list.

## Getting started

```bash
npm install
npm run db:seed     # creates data/repository.db and loads six example systems
npm run dev         # http://localhost:3000
```

The database is migrated automatically on first connection. `npm run db:reset` replaces all data with the seed records.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development, production build, production server |
| `npm run lint` / `typecheck` / `test` | ESLint, TypeScript, Vitest |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:seed` / `db:reset` | Seed an empty repository / replace all data with seed records |
| `npm run corpus:export` | Write the local database to `corpus/systems.json` |
| `npm run corpus:import` | Load `corpus/systems.json` into an empty database (`-- --replace` to overwrite) |
| `npm run build:static` | Build the read-only static site into `out/` |
| `npm run plugin:build` | Bundle the Claude Code plugin CLI and copy the extraction prompt into `plugin/` |

Set `DATABASE_PATH` to use a database file other than `data/repository.db`.

## Design

`/design` composes grammar processes for a new system. Steps from the corpus can be searched or suggested from the current state and appended, each representation can be described by what it contains (the grammar records only its kind), similar systems are ranked with the measures used by Compare, and referenced papers are kept with the design. The design lives in the URL (`?d=`), so it works on the static site and can be shared as a link.

## Claude Code plugin

```
/plugin marketplace add sjoerdvink99/human-AI-grammar
/plugin install human-ai@human-ai-grammar
```

| Skill | Use |
| --- | --- |
| `/human-ai:extract <paper>` | extract validated system records from papers with `corpus/prompt.md` |
| `/human-ai:design <goal>` | design a system in conversation and get a Design page link |
| `/human-ai:implement <design>` | implement a design link, `design.json`, or expression in the current codebase |

The skills use `plugin/scripts/human-ai.mjs`, a CLI bundled from `src/plugin/cli.ts` with the website's parser, similarity measures, and corpus snapshot. CI fails when the committed plugin is out of date, so run `npm run plugin:build` after changing `src/domain`, `corpus/systems.json`, or `corpus/prompt.md`.

## Publishing to GitHub Pages

The app is read-only: systems are added and changed in `corpus/systems.json`, not through the interface. The published site is a static export of that snapshot.

1. Commit the corpus you want to publish in `corpus/systems.json`.
2. Push to `main`. The workflow in `.github/workflows/pages.yml` runs lint, typecheck, and tests, imports the snapshot, builds with `STATIC_EXPORT=1`, and deploys `out/`.
3. One-time setup: in the repository settings, set **Pages → Source** to **GitHub Actions**.

## Structure

```
src/
  domain/
    grammar/    tokenizer, parser, formatter, features, similarity, vocabulary seeds
    systems/    domain types, corpus entries, filters, facets, dimensions, import schema
    analysis/   k-means grouping and multi-system comparison
    design/     design specs, step search and suggestions, similar systems
  plugin/       CLI bundled into the Claude Code plugin
  db/           Drizzle schema, client, queries, seed data
  lib/          repository loading, URL query state, formatting
  components/   grammar, systems, design, editor, explore, compare, ui
  app/          routes: /, /systems, /systems/[id], /explore, /compare, /vocabulary, /design
```

## Extending

- **Dimensions** — add an entry to `domain/systems/dimensions.ts`; it appears in the scatterplot axes, range filters, and grouping.
- **Filters** — add a predicate to `domain/systems/filters.ts` and map it from `SystemQuery`.
- **Similarity** — add or replace measures in `domain/grammar/similarity.ts`; the compare view documents them automatically.
- **Import** — the JSON import format is `systemRecordSchema` in `domain/systems/schema.ts`.
