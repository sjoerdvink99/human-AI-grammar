# Human-AI Grammar Extraction Prompt

You are extracting a formal description of a Human-AI system from an attached research paper.

Your task is to reconstruct the system as faithfully as possible using the Human-AI grammar below.

Do not summarize the paper broadly.
Do not describe intended use, evaluation, or study procedure unless it is part of the system process.
Do not invent steps that are not supported by the paper.
Prefer the system description, figures, implementation details, and use cases as evidence.

## Grammar

```text
process   ::= state (-> transform -> state)+
state     ::= rep (+ rep)*
rep       ::= ( id : role medium ) *?
transform ::= [ actor operation ] ~?
actor     ::= human | model | tool   (optionally with an instance suffix: model_1)
```

A representation has:
- `id`: semantic identifier with a version number
- `role`: its function in the process
- `medium`: how its information is encoded
- `*`: optional, marks a collection of many items of the same kind

Current roles: `instruction`, `artifact`, `selection`, `label`, `evaluation`.

Current media:

| Medium | Encoding |
| --- | --- |
| `language` | natural language text |
| `visual` | images, renderings, charts, video |
| `spatial` | positions, regions, layouts, coordinates, masks |
| `record` | named fields: configurations, specifications, requests, profiles, tool calls, JSON objects |
| `tabular` | rows and columns: datasets, tables, spreadsheets |
| `graph` | nodes and links: graphs, trees, hierarchies, workflows, pipelines |
| `numeric` | numbers and vectors: scores, metrics, weights, embeddings, latents |
| `categorical` | values from a fixed set: choices, modes, categories, flags, decisions |
| `formal` | code, queries, logic, DSLs |
| `audio` | speech and sound |
| `multimodal` | several encodings that cannot be separated |

There is no general `structured` medium: say how the structure is organised.
A list of text items is `language` with `*`, not a record.

Current operations: `generate`, `modify`, `select`, `specify`, `translate`, `expand`, `extract`, `decompose`, `compose`, `match`, `evaluate`, `execute`, `delegate`, `assign`, `train`.

These vocabularies are open.
Use an existing term when it fits.
When none of the existing terms captures the paper accurately, introduce a new role, medium, or operation yourself rather than forcing a poor fit.
A new term is a single lowercase word or snake_case phrase, such as `rank` or `gesture`, and must be explained in `system.notes` (see Parser and Corpus Constraints, rule 5).

## Notation

Representations:

```text
(id: role medium)
```

Transformations:

```text
[actor operation]
```

Transitions:

```text
(state) -> [actor operation] -> (state)
```

Multiple representations in one state:

```text
(rep_1) + (rep_2)
```

Collection, a representation that holds many items of the same kind:

```text
(images_1: artifact visual)*
```

Generative transformation, one that creates new content so the same input can give different outputs:

```text
[actor operation]~
```

A loop, a step that ends in an earlier state, with exactly the same identifiers, and so goes back to it:

```text
(prompt_1: instruction language)
-> [model generate]~
-> (image_1: artifact visual)
-> [human modify]
-> (prompt_1: instruction language)
```

Actor instances may be distinguished when necessary:

```text
[model_1 generate]~
[model_2 evaluate]~
```

## Extraction Rules

1. Reconstruct the actual process described by the system, not an idealized workflow.

2. Identify both human-facing and computational steps.
Include transformations performed by humans, models, and tools when they are part of the system process.

3. Treat meaningful intermediate information as a representation.
Examples include prompts, plans, selections, labels, generated artifacts, structured requirements, code, tool calls, feedback, and execution results.

4. Do not treat transient implementation details as representations unless they play a meaningful role in the described process.

5. Preserve representation identity.
If a representation persists unchanged across a transition, reuse the same identifier and version.

Example:

```text
(graph_1: artifact graph)
-> [model expand]~
-> (graph_1: artifact graph) + (req_1: instruction record)
```

6. Increment a representation version only when its content changes, except at the end of a loop round (see rule 15).

Example:

```text
(artifact_1: artifact language)
-> [human modify]
-> (artifact_2: artifact language)
```

7. Use different identifiers for representations that contain different information.

8. Distinguish actor instances whenever the system uses more than one model or tool with different responsibilities.
Use `model_1`, `model_2`, and so on, and keep each number for the same model across all processes of the system.
This is common: a language model may write a prompt for an image model, and a third model may critique the result.
Keep the representations passed between models, such as a generated prompt or a critique, explicit.
Say in each process `description` what kind of model each instance is, using the paper's terms (for example "GPT-4", "a diffusion model", "a vision-language model").
Use a single unnumbered `model` when the system uses one model throughout.
Record what the paper says about each model and tool in `system.actors` (see System Fields), not in the expressions.

Example:

```text
(draft_1: artifact language)
-> [model_2 evaluate]~
-> (feedback_1: evaluation language)
-> [model_1 modify]~
-> (draft_2: artifact language)
```

9. Mark a transformation with `~` when it is generative: a model creates new content, such as text, images, code, plans, or critiques, so the same input can give different outputs.
Leave it unmarked when the step is not generative: a model that classifies, embeds, segments, transcribes, or scores, a tool, even one that samples at random, and every human step.

10. Mark a representation with `*` when it holds many items of the same kind that are produced, shown, or chosen from together, such as four generated images, a list of suggestions, or a set of retrieved papers.
Do not mark a single artifact that merely has parts, such as one document, one table, or one configuration with several fields.
Give a collection a plural identifier, and keep the marker on that identifier in every state and process where it appears.
Selecting one item from a collection produces a new representation without `*`.

Example:

```text
(prompt_1: instruction language)
-> [model generate]~
-> (images_1: artifact visual)*
-> [human select]
-> (image_1: artifact visual)
```

11. Do not collapse meaningful intermediary representations.
If the system explicitly creates a plan, structured prompt, code representation, tool call, evaluation, or similar intermediate artifact, preserve it.

12. Do not unnecessarily expand implementation details.
Represent the process at the level necessary to explain the interaction and computational structure of the system.

13. If the system contains multiple distinct processes or interaction modes, represent them as separate named processes rather than forcing them into one sequence.
One process is one complete interaction or computation, from what the user or system starts with to what comes out.
Do not split a single interaction into one process per step.

14. Start a process from the representations it begins with, such as a prompt the user writes, a dataset, an uploaded document, a system resource, or the output of another process.
Do not write a step that creates the first representation from nothing; a prompt the user writes is simply the first state.
If the user writes something while other information is already present, start from that information and let the user's input appear in a later state, usually through `[human specify]`.

Example:

```text
(prompt_1: instruction language)
-> [model generate]~
-> (draft_1: artifact language)
```

15. Write a loop by going back to an earlier state.
When steps repeat, write one round, and let its last step end in the state the next round starts from, with exactly the same identifiers and versions as where that state first appeared.
That last step keeps the earlier versions even though it changes their content: going back to the state is what says the next round works on the changed content.
Inside the round, increment versions as usual.
Every step that ends in an earlier state is read as a loop, so never end in an earlier state otherwise, for example by dropping a representation and bringing it back.
Say in the process `description` when the loop stops, such as "until the user is satisfied with the image".
Do not write a loop when the paper only says that a process can be started again with new input.

Example:

```text
(prompt_1: instruction language)
-> [model generate]~
-> (image_1: artifact visual)
-> [human modify]
-> (prompt_1: instruction language)
```

The last state equals the first, so the rewritten prompt goes back to the model for a new image.

16. If evidence is insufficient to determine a transformation or representation, choose the most conservative expression the paper supports and record the uncertainty in `system.notes`.

17. Every extracted process must be traceable to evidence in the paper.

## Relationships Between Processes

How processes relate is not written in the grammar. It is derived from shared identifiers, so identifiers must be consistent across all processes of a system.

Process B continues from process A when B's first state contains an identifier, with the same name and version, that A produces in any later state.
A process whose first state contains only representations no other process produces is an entry point.

1. Start each process from the representations it actually needs, with the exact identifiers and versions under which another process produced them.
If the overview process produces `(canvas_1: artifact spatial)` and the user then reorganises that canvas, the reorganisation process starts from `(canvas_1: artifact spatial)`.

2. Use the same identifier and version for the same information in every process of the system, including its role and medium.

3. Never reuse an identifier for different information in another process.
If two processes produce different summaries, name them `summary_1` and `section_summary_1`, not both `summary_1`.

4. When a process produces a changed version of a representation, increment its version (`canvas_1` to `canvas_2`).
A process that starts from the original uses `canvas_1`; a process that only makes sense after the change uses `canvas_2`.

5. Start a process from fresh identifiers only when its input really comes from outside the other processes, such as an uploaded file or a prompt the user writes (see Extraction Rules, rule 14).

6. Order the processes so the main or first process comes first, followed by processes that continue from it.

7. Say in each process `description` what triggers it, for example "After the overview is generated, the user can drag any card to regroup it."

Example of two connected processes:

```text
Generate plan:
(task_1: instruction language)
-> [model generate]~
-> (plan_1: artifact record)

Edit plan:
(plan_1: artifact record)
-> [human modify]
-> (plan_2: artifact record)
-> [model generate]~
-> (plan_2: artifact record) + (code_1: artifact formal)
```

`Edit plan` continues from `Generate plan` through `plan_1`.

## Examples

### Example 1: Direct Generation

Paper behavior:

The user writes a natural-language prompt and the model generates text.

Expression:

```text
(prompt_1: instruction language)
-> [model generate]~
-> (artifact_1: artifact language)
```

### Example 2: Direct Manipulation

Paper behavior:

The model has generated an artifact.
The user selects a region and provides a local instruction.
The system converts this interaction into a prompt and the model revises the artifact.

Expression:

```text
(artifact_1: artifact language)
-> [human select]
-> (artifact_1: artifact language) + (region_1: selection spatial)
-> [human specify]
-> (artifact_1: artifact language) + (region_1: selection spatial) + (instruction_1: instruction language)
-> [tool translate]
-> (artifact_1: artifact language) + (prompt_2: instruction language)
-> [model modify]~
-> (artifact_2: artifact language)
```

If the paper also describes how `artifact_1` was first generated, that is a separate process, and this process continues from it through `artifact_1`.

### Example 3: Multi-Agent Evaluation

Paper behavior:

An earlier process has decomposed the task into subtasks.
One model generates a draft for a subtask.
A second model evaluates the draft.
The first model revises it using the feedback, until the second model accepts it.

Expression:

```text
(subtask_1: instruction record)
-> [model_1 generate]~
-> (draft_1: artifact language)
-> [model_2 evaluate]~
-> (draft_1: artifact language) + (feedback_1: evaluation language)
-> [model_1 modify]~
-> (draft_1: artifact language)
```

The last state equals the second, so the revised draft goes back to the second model for another evaluation.
The process starts from `subtask_1`, which another process of the same system produced.

### Example 4: Model Chain

Paper behavior:

The user describes a scene.
A language model expands the description into a detailed image prompt.
A diffusion model renders four candidate images.
As long as the user is not satisfied, a vision-language model critiques the images against the original description, the language model revises the prompt, and the diffusion model renders new images.
The user then picks one image.

Expression, as two processes, because the choice of one image follows the loop:

```text
(scene_1: instruction language)
-> [model_1 expand]~
-> (prompt_1: instruction language)
-> [model_2 generate]~
-> (images_1: artifact visual)*
-> [model_3 evaluate]~
-> (images_1: artifact visual)* + (critique_1: evaluation language)
-> [model_1 modify]~
-> (prompt_1: instruction language)
```

```text
(images_1: artifact visual)*
-> [human select]
-> (image_1: artifact visual)
```

Description of the first process:

```text
The user describes a scene. A language model turns it into a detailed prompt and a diffusion model draws four images. Until the user is satisfied, a vision-language model critiques the images so the language model can improve the prompt for a new set.
```

## Procedure

Read the full paper before producing the final extraction.

Determine:
- the system's main interaction process
- meaningful intermediary representations
- transformations between them
- the actor performing each transformation
- which distinct models and tools the system uses, and what each is responsible for
- which transformations are generative
- which representations are collections of many items
- which steps repeat, and when they stop
- whether the paper contains multiple distinct processes
- which representations each process starts from, and which other process produced them

Check system figures and examples against the textual description.
Resolve inconsistencies conservatively in favor of what the paper explicitly states.

## Repository Output Format

Return exactly one JSON object per paper in the following shape:

```json
{
  "paper": {
    "title": "…",
    "authors": ["First Last", "…"],
    "year": 2024,
    "venue": "CHI",
    "citationKey": "masson2024directgpt",
    "doi": "10.1145/3613904.3642462",
    "url": "https://…",
    "abstract": "…",
    "notes": "…",
    "tags": ["agents", "text editing"]
  },
  "system": {
    "name": "DirectGPT",
    "description": "One or two sentences on what the system does",
    "processScope": "end-to-end workflow",
    "notes": "…",
    "actors": {
      "model": { "name": "…", "kind": "…" }
    }
  },
  "processes": [
    {
      "name": "Co-plan",
      "description": "The user states a task and the model drafts a step-by-step plan, which the user then edits before anything runs.",
      "rawExpression": "(task_1: instruction language)\n-> [model generate]~\n-> (plan_1: artifact record)\n-> [human modify]\n-> (plan_2: artifact record)"
    }
  ]
}
```

The output must conform to the repository's `systemRecordSchema`.

### Paper Fields

- `title`: paper title.
- `authors`: array of author names in paper order.
- `year`: publication year as an integer.
- `venue`: short venue name such as `CHI`, `UIST`, `IEEE VIS`, or `arXiv`.
- `citationKey`: unique citation key of the form first author's surname, year, and first meaningful title word, all lowercase, such as `masson2024directgpt`.
- `doi`: optional bare DOI without `https://doi.org/`.
- `url`: optional valid URL.
- `abstract`: optional paper abstract.
- `notes`: optional paper-level notes.
- `tags`: concise array of useful system-level search terms.

### System Fields

- `name`: system name.
- `description`: one or two concise sentences describing what the system does.
- `processScope`: optional description of which part of the system the extracted processes cover.
- `notes`: optional system-level notes.
- `actors`: optional details of the models and tools behind the actor instances in the expressions.
  Each key is an actor exactly as written in the expressions, such as `model`, `model_2`, or `tool_1`; humans are not listed.
  Each value has up to four optional fields:
  - `name`: the model or tool as the paper names it, such as `GPT-4o`, `Stable Diffusion XL`, or `Semantic Scholar API`.
  - `version`: a specific version, snapshot, checkpoint, or size, such as `gpt-4o-2024-08-06`, `1.0`, or `70B`.
  - `provider`: the organisation that provides it, such as `OpenAI` or `Stability AI`.
  - `kind`: what kind of model or tool it is, such as `language model`, `diffusion model`, `vision-language model`, `embedding model`, or `search API`.

Papers often do not say which model they use, or name it without a version.
Fill in only what the paper states, and leave out every field it does not.
Never guess a name, version, or provider from the publication date or from what was common at the time.
Give `kind` when the paper describes the model's type, even if it does not name the model.
Leave out an actor that the paper says nothing about, and leave out `actors` entirely when the paper says nothing about any of its models or tools.
Keep these details in `actors` only; do not repeat them in `system.notes`.

Example, for a paper that names GPT-4o with its snapshot, says only that images come from "a diffusion model", and runs a `tool` step it does not describe:

```json
"actors": {
  "model_1": { "name": "GPT-4o", "version": "gpt-4o-2024-08-06", "provider": "OpenAI", "kind": "language model" },
  "model_2": { "kind": "diffusion model" }
}
```

### Process Fields

Each process contains:

- `name`: concise process name, required.
- `description`: required. One or two short, plain sentences saying what actually happens in this process: what the person does, what the AI does, and what comes out. Write for a reader who has not seen the paper or the grammar. Avoid grammar terms such as representation, transformation, state, or identifiers like `draft_1`. Name the kind of model when the paper says, especially when several models are involved. State what triggers the process and when it repeats, for example "Repeats until the user accepts the draft."
- `rawExpression`: the grammar expression as a single JSON string with `\n` between lines.

Good description: "The designer brushes over part of the image and types what should change there; an image model repaints only that region."
Poor description: "The human selects a spatial selection and specifies an instruction, then the model modifies the visual artifact."

Use multiple process objects when the paper contains distinct workflows, branches, modes, or interaction processes that should not be forced into one sequence.

## Parser and Corpus Constraints

These rules are strict.

1. Actors must be `human`, `model`, or `tool`, optionally with an instance suffix such as `model_1`.
   Do not use alternatives such as `user`, `llm`, `agent`, or `system` as actors.

2. The generative marker `~` must appear immediately after the closing transformation bracket:

```text
[model generate]~
```

The collection marker `*` must appear immediately after the closing parenthesis of a representation:

```text
(images_1: artifact visual)*
```

3. Every process must start from a state and contain at least one transformation:

```text
state -> [actor op] -> state
```

4. Representation identifiers must use lowercase snake_case with a numeric version suffix.

Valid examples:

```text
prompt_1
artifact_2
tool_call_1
agent_config_3
```

Reuse the same identifier and version when a representation persists unchanged through a step.
Increment the version when that representation is modified, except in the step that closes a loop round.

Example:

```text
(plan_1: artifact record)
-> [human modify]
-> (plan_2: artifact record)
```

5. Representations must use exactly this form:

```text
(id: role medium)
```

Each representation has exactly one role and one medium.

Prefer the existing vocabulary listed under Grammar whenever it fits.
New roles, media, or operations are allowed when the existing vocabulary is clearly insufficient.
Do not stretch an existing term to cover a different meaning; introduce a new term instead.
For each new term, add a sentence to `system.notes` in the form `New operation rank: the model orders candidates by predicted quality.` (likewise `New role …` or `New medium …`).

6. Inside `rawExpression`, use only:
- letters
- digits
- `_`
- `-`
- spaces
- line breaks
- `(`
- `)`
- `[`
- `]`
- `:`
- `+`
- `~`
- `*`
- `->`

Do not include commas, quotation marks, comments, labels, or prose inside a grammar expression.

7. Preserve meaningful intermediary representations rather than collapsing them into one step.

8. Do not invent a process step merely to make the expression cleaner or more complete.

9. If a process is uncertain, choose the most conservative expression supported by the paper.
Use `system.notes` only for a short uncertainty note or to explain new vocabulary.
Do not encode uncertainty syntax inside `rawExpression`.

10. Before returning the result, silently validate that:
- every representation has a valid identifier, role, and medium
- every transformation has a valid actor and operation
- every process contains at least one transformation
- representation versions are consistent
- generative markers are placed exactly on the generative steps
- collection markers are correctly placed and consistent for each identifier
- every loop ends in an earlier state with exactly the same identifiers, no other step ends in an earlier state, and the description says when each loop stops
- no representation uses the medium `structured`
- all grammar syntax satisfies the allowed character set
- every extracted step is supported by the paper
- every process has a `name` and a plain-language `description` that says what triggers it
- identifiers are consistent across processes, so a process that continues from another starts from the exact identifiers and versions that the other produced
- no identifier is reused for different information in different processes
- distinct models use distinct, consistent actor instances, and each description says which model does what
- every key in `system.actors` is an actor that appears in the expressions, and every detail in it is stated in the paper
- every new vocabulary term is explained in `system.notes`

## Final Output Rule

Return raw JSON only.

Do not use Markdown fences.
Do not add explanations before or after the JSON.
Do not return the validation checklist.
Do not return evidence notes outside the schema.
