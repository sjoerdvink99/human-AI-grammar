---
name: design
description: Design a new Human-AI system as grammar expressions, using the corpus of published systems for inspiration, and produce a shareable design link. Use when the user wants to design, sketch, or explore an interaction or workflow for a Human-AI system before implementing it.
argument-hint: <what the system should help people do>
---

# Design a Human-AI system

Goal: $ARGUMENTS

Load the `grammar` skill for the notation and the CLI. The website's Design page offers the same workflow visually; this skill is the conversational version.

1. **Clarify the goal** in one or two questions at most: who the human is, what they produce, and where the model helps. Skip questions the goal already answers.
2. **Sketch** a first process: the initial state, then one transformation at a time. Keep it short; three to six transformations is typical.
3. **Draw on the corpus** at every step:
   - `next "<expression so far>"` shows what published systems do from a similar state.
   - `search <terms>` finds steps by actor, operation, role, medium, or topic.
   - `similar "<expression>"` names the closest systems; `show <key>` explains how they work.
   Cite the systems you borrow from by name and citation key.
4. **Validate** each revision with `parse` and show it as a code block. Point out trade-offs a designer would care about: where humans keep control, which steps are stochastic and need review, and which representations must be visible together.
5. **Connect processes.** Use a separate process for each mode of interaction. Start a follow-up process from the representations an earlier one produced, so the connection is explicit.
6. **Describe in plain words.** Give every process a `description` of one or two sentences: what the person does, what each model or tool does, and what triggers the process or when it repeats. Name the kind of model when it matters, especially when several models are chained (`model_1` writes a prompt, `model_2` renders the image). Give the design a `description` of a few sentences on how the system works as a whole and how its processes fit together.
7. **Describe the content.** The grammar says what kind of representation each identifier is, not what it holds. For every identifier (without its version), write one sentence on what it contains and any constraint on it, such as "a short story, only about cats or dogs".
8. **Iterate** with the user until they are satisfied.
9. **Hand off.** Write the design to `design.json`:

   ```json
   { "name": "…", "goal": "…", "description": "…", "processes": [{ "name": "…", "description": "…", "rawExpression": "…" }], "representations": { "prompt": "…", "story": "…" }, "references": ["citationKey"] }
   ```

   Run `link design.json` and give the user the link, which opens the design on the website, and suggest `/human-ai:implement design.json` as the next step.
