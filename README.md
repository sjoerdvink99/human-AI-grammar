# A Grammar for Human-AI Systems

Sjoerd Vink

A research tool for describing, comparing, and exploring Human-AI systems through a common process grammar.

## Grammar

```
process   ::= state (-> transform -> state)+
state     ::= rep (+ rep)*
rep       ::= ( id : role medium ) *?
transform ::= [ actor operation ] ~?
actor     ::= human | model | tool   (optionally with an instance suffix: model_1)
role      ::= instruction | artifact | selection | label | evaluation | …
medium    ::= language | visual | spatial | record | tabular | graph | numeric | categorical | formal | audio | …
op        ::= generate | modify | select | specify | translate | expand | extract | decompose
            | compose | match | evaluate | execute | delegate | assign | train | …
```

```
(prompt_1: instruction language)
-> [model generate]~
-> (drafts_1: artifact language)*
-> [human modify]
-> (prompt_1: instruction language)
```

`| …` marks an open vocabulary: the listed terms are seeds, and any new term is accepted. `~` marks a generative transformation, one that creates new content. `*` marks a collection of many items of one kind. A step that ends in an earlier state, with exactly the same identifiers, goes back to it, which makes a loop: in the example the user rewrites the prompt and the model drafts again.

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
| `npm run corpus:screenshots` | List systems that have no screenshot yet |
| `npm run build:static` | Build the read-only static site into `out/` |
| `npm run plugin:build` | Bundle the Claude Code plugin CLI and copy the extraction prompt into `plugin/` |

Set `DATABASE_PATH` to use a database file other than `data/repository.db`.

## Explore

`/explore` plots the corpus as a scatterplot, bar chart, pie chart, or process tree. The tree merges every process whose initial state contains the chosen root representation and branches wherever the processes stop taking the same next step: each edge is a transformation (actor instances are merged) and each node the representations that step introduces, at the chosen detail (`role medium`, `role`, or `medium`). It is drawn as a treemap: each tile is a next step, sized by how many processes take it and previewing the steps after it, with a grey tile for the processes that end there. Clicking a tile descends into that branch, and the path above the treemap leads back up.

## Design

`/design` composes grammar processes for a new system. A design has a name, a goal, and a plain-language description of how the system works; each process has its own description of what happens and when. Steps from the corpus can be searched or suggested from the current state and appended, each representation can be described by what it contains (the grammar records only its kind), similar systems are ranked with the measures used by Compare, and referenced papers are kept with the design. The design lives in the URL (`?d=`), so it works on the static site and can be shared as a link.

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

## Corpus

Each record in `corpus/systems.json` holds the paper, the system, and its processes. A process has a `name`, a plain-language `description` of what happens and who or what does it, and the `rawExpression`. New records are extracted with `corpus/prompt.md`.

Screenshots live in `public/screenshots/`, named after the paper's citation key. For multiple screenshots, place them in `public/screenshots/<citationKey>/`; a legacy single image at `public/screenshots/<citationKey>.png` also works (`.webp`, `.jpg`, and `.jpeg` are supported). A system page shows all images in the folder. Keep images around 1600 px wide.

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
