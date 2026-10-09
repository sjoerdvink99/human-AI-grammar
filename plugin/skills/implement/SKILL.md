---
name: implement
description: Implement a Human-AI system from a grammar design, given a design link from the Human-AI grammar website, a design.json file, or a raw expression. Use when the user asks to build, implement, or scaffold a system from a Human-AI grammar design or expression.
argument-hint: <design link | design.json | expression>
---

# Implement a Human-AI grammar design

Design: $ARGUMENTS

Load the `grammar` skill for the notation and the CLI.

## 1. Load the design

- For a link or file, run `design "<argument>"`. For a bare expression, run `parse "<argument>"`.
- If any process fails to parse, show the error and stop until the user fixes it.
- For every reference, run `show <citation key>` and read how that system realizes its steps. References are inspiration, not specifications.

## 2. Read the target codebase

Identify the stack, UI framework, state management, existing model or LLM client, and test setup. Build on what exists. If the repository is empty, propose a minimal stack and confirm it before scaffolding.

## 3. Map the grammar onto code

Every representation and transformation must map to something concrete:

| Grammar | Implementation |
| --- | --- |
| `(id: role medium)` | a typed piece of application state, named after `id` without its version |
| medium `language` | text, rendered as prose or an editable text field |
| medium `structured` | a typed object with a schema; model outputs use structured output or validated JSON |
| medium `formal` | code or a query, shown with syntax highlighting, executed by a tool step |
| medium `visual` | an image, canvas, or chart |
| medium `spatial` | positions or regions, interacted with directly on a canvas or view |
| medium `audio` | recorded or synthesized sound |
| role `instruction` | input that directs an actor: a prompt field, a request form, a constraint editor |
| role `artifact` | the primary object, owned by the main view and editable where the design has a human modify it |
| role `selection` | selection state that refers into another representation |
| role `label` | an annotation attached to the thing it labels |
| role `evaluation` | feedback, scores, or verdicts, shown next to what they judge |
| state `a + b` | representations that must be available together: in the same view for humans, in the same context for models |
| same `id`, same version | unchanged information carried forward, not recomputed |
| version change `x_1 → x_2` | an update to the same state; keep earlier versions when a later step compares or reverts them |
| `[human op]` | a UI interaction whose affordance fits the operation: `select` on the medium itself, `specify` through input, `modify` through direct editing, `evaluate` through review controls |
| `[model op]` | a model call with typed input and output; one prompt per operation, built only from the representations in the preceding state |
| `[model_1 op]`, `[model_2 op]` | distinct model roles with separate prompts or configurations |
| `[tool op]` | deterministic code: retrieval, execution, parsing, conversion |
| `~` | nondeterminism handled explicitly: loading and streaming states, regeneration, validation of outputs, and human review before results are committed where a human step follows |

The design's `representations` describe what each identifier contains, keyed by identifier without its version. Treat them as requirements: they set the content of model prompts and output schemas, the fields of input forms, and the validation applied to stochastic outputs. A constraint such as "only about cats or dogs" must be enforced where the representation is produced, not only stated in a prompt. When an identifier has no description, infer one from the goal and confirm it in the plan.

The design's `description` says how the system works as a whole; use it to decide how the processes come together in one application. Separate processes are separate flows or modes of the same application. The `design` command lists how they connect: a process that continues from another starts from the representations the other produced, and processes that work with the same identifier share that state. Each process may have a `description` saying in plain words what happens, which kind of model does what, and what triggers the process or when it repeats; implement those triggers literally, and ask when a process has neither a connection nor a description.

## 4. Plan and confirm

Present a plan before writing code:

- a table of representations: identifier, type, contents, and file
- a table of transformations in process order: actor and operation, function or component, and file
- choices the design leaves open, such as model provider, persistence, and layout, with a recommended default for each

Ask the user to confirm. Do not add steps that are not in the design; if the implementation needs one, propose an updated expression, validate it with `parse`, and offer a new design link with `link`.

## 5. Implement

Work process by process, in order. Keep names traceable to the design so each identifier and operation can be found in the code. Follow the codebase's conventions.

## 6. Record and verify

- Save the design as `design.json` at the repository root unless one exists, and add a short section to the README or docs that maps each transformation to the code that implements it.
- Run the build, type checker, and tests. Walk through each process once and confirm every transformation is reachable in the running application, reporting any that are not.
