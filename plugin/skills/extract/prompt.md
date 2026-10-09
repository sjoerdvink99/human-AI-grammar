# Human-AI Grammar Extraction Prompt

You are extracting a formal description of a Human-AI system from an attached research paper.

Your task is to reconstruct the system as faithfully as possible using the Human-AI grammar below.

Do not summarize the paper broadly.
Do not describe intended use, evaluation, or study procedure unless it is part of the system process.
Do not invent steps that are not supported by the paper.
Prefer the system description, figures, implementation details, and use cases as evidence.

## Grammar

```text
process   ::= state (transform state)+
state     ::= rep (+ rep)*
rep       ::= id : role medium
transform ::= actor op

actor ::= human | model | tool
```

A representation has:
- `id`: semantic identifier with a version number
- `role`: its function in the process
- `medium`: how its information is encoded

Current roles include:
- `instruction`
- `artifact`
- `selection`
- `label`
- `evaluation`

Current media include:
- `language`
- `visual`
- `spatial`
- `structured`
- `formal`
- `audio`

Current operations include:
- `generate`
- `modify`
- `select`
- `specify`
- `translate`
- `expand`
- `extract`
- `decompose`
- `compose`
- `match`
- `evaluate`
- `execute`
- `delegate`
- `assign`
- `configure`

These vocabularies are open.
Use an existing term when it fits.
Introduce a new role, medium, or operation only when none of the existing terms captures the paper accurately.

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

Stochastic transformation:

```text
[actor operation]~
```

Actor instances may be distinguished when necessary:

```text
[model_1 generate]
[model_2 evaluate]
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
(graph_1: artifact structured)
-> [model expand]~
-> (graph_1: artifact structured) + (req_1: instruction structured)
```

6. Increment a representation version only when its content changes.

Example:

```text
(artifact_1: artifact language)
-> [human modify]
-> (artifact_2: artifact language)
```

7. Use different identifiers for representations that contain different information.

8. Distinguish actor instances only when the distinction matters to the system structure.

Example:

```text
(draft_1: artifact language)
-> [model_2 evaluate]~
-> (feedback_1: evaluation language)
-> [model_1 modify]~
-> (draft_2: artifact language)
```

9. Mark a transformation with `~` when the same input may produce different outputs because the transformation is generative or otherwise stochastic.
Do not mark ordinary deterministic tool execution as stochastic.

10. Do not collapse meaningful intermediary representations.
If the system explicitly creates a plan, structured prompt, code representation, tool call, evaluation, or similar intermediate artifact, preserve it.

11. Do not unnecessarily expand implementation details.
Represent the process at the level necessary to explain the interaction and computational structure of the system.

12. If the system contains multiple distinct processes, branches, or interaction modes, represent them as separate named processes rather than forcing them into one sequence.

13. If a process contains a loop, represent one iteration of the loop and explicitly state the recurrence condition separately.
Do not invent dedicated loop syntax.

14. If evidence is insufficient to determine a transformation or representation, mark it as uncertain rather than guessing.

15. Every extracted process must be traceable to evidence in the paper.

## Examples

### Example 1: Direct Generation

Paper behavior:

The user supplies a natural-language prompt and the model generates text.

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

Expressions:

```text
(artifact_1: artifact language)
-> [human select]
-> (artifact_1: artifact language) + (region_1: selection spatial)

(artifact_1: artifact language) + (region_1: selection spatial)
-> [human specify]
-> (artifact_1: artifact language) + (region_1: selection spatial) + (instruction_1: instruction language)

(artifact_1: artifact language) + (region_1: selection spatial) + (instruction_1: instruction language)
-> [tool translate]
-> (artifact_1: artifact language) + (prompt_2: instruction language)

(artifact_1: artifact language) + (prompt_2: instruction language)
-> [model modify]~
-> (artifact_2: artifact language)
```

### Example 3: Multi-Agent Evaluation

Paper behavior:

One model generates a draft.
A second model evaluates the draft.
The first model revises it using the feedback.

Expression:

```text
(subtask_1: instruction structured)
-> [model_1 generate]~
-> (draft_1: artifact language)
-> [model_2 evaluate]~
-> (feedback_1: evaluation language)
-> [model_1 modify]~
-> (draft_2: artifact language)
```

## Procedure

Read the full paper before producing the final extraction.

Determine:
- the system's main interaction process
- meaningful intermediary representations
- transformations between them
- the actor performing each transformation
- whether each transformation is stochastic
- whether the paper contains multiple distinct processes

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
    "notes": "…"
  },
  "processes": [
    {
      "name": "Co-plan",
      "rawExpression": "(task_1: instruction language)\n-> [model generate]~\n-> (plan_1: artifact structured)\n-> [human modify]\n-> (plan_2: artifact structured)"
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
- `citationKey`: unique citation key containing only letters, digits, `_`, `:`, `.`, or `-`.
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

### Process Fields

Each process contains:

- `name`: concise process name.
- `rawExpression`: the grammar expression as a single JSON string with `\n` between lines.

Use multiple process objects when the paper contains distinct workflows, branches, modes, or interaction processes that should not be forced into one sequence.

## Parser and Corpus Constraints

These rules are strict.

1. Actors must be `human`, `model`, or `tool`, optionally with an instance suffix such as `model_1`.
   Do not use alternatives such as `user`, `llm`, `agent`, or `system` as actors.

2. The stochastic marker `~` must appear immediately after the closing transformation bracket:

```text
[model generate]~
```

3. Every process must contain at least one transformation:

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
Increment the version when that representation is modified.

Example:

```text
(plan_1: artifact structured)
-> [human modify]
-> (plan_2: artifact structured)
```

5. Representations must use exactly this form:

```text
(id: role medium)
```

Each representation has exactly one role and one medium.

Prefer the existing vocabulary whenever it fits.

Roles:
- `instruction`
- `artifact`
- `selection`
- `label`
- `evaluation`

Media:
- `language`
- `visual`
- `spatial`
- `structured`
- `formal`
- `audio`

Operations:
- `generate`
- `modify`
- `select`
- `specify`
- `translate`
- `expand`
- `extract`
- `decompose`
- `compose`
- `match`
- `evaluate`
- `execute`
- `delegate`
- `assign`
- `configure`

New roles, media, or operations are allowed, but should be rare and introduced only when the existing vocabulary is clearly insufficient.

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
- `->`

Do not include commas, quotation marks, comments, labels, or prose inside a grammar expression.

7. Preserve meaningful intermediary representations rather than collapsing them into one step.

8. Do not invent a process step merely to make the expression cleaner or more complete.

9. If a process is uncertain, choose the most conservative expression supported by the paper.
Use `system.notes` only when a short uncertainty note is necessary.
Do not encode uncertainty syntax inside `rawExpression`.

10. Before returning the result, silently validate that:
- every representation has a valid identifier, role, and medium
- every transformation has a valid actor and operation
- every process contains at least one transformation
- representation versions are consistent
- stochastic markers are correctly placed
- all grammar syntax satisfies the allowed character set
- every extracted step is supported by the paper

## Final Output Rule

Return raw JSON only.

Do not use Markdown fences.
Do not add explanations before or after the JSON.
Do not return the validation checklist.
Do not return evidence notes outside the schema.
