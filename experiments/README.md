# Rebuilt systems

Each folder here is a system from the corpus that an agent (Claude Code, Opus 5.5) rebuilt as a runnable web app from its grammar expressions alone. The agent never saw the paper, and the system was removed from the corpus it could look things up in. Comparing a rebuild with the original shows what the expressions capture and what they leave out.

Every system has three rebuilds, one per condition:

| Folder | What the agent received |
|---|---|
| `full/` | The expressions, with the system, process and representation descriptions. System, model and tool names are replaced with neutral ids. |
| `expressions/` | The expressions only. |
| `anonymized/` | The expressions only, with every representation name replaced by a neutral id (`r1`, `r2`, …), so names such as `vega_spec` give no hints. |

Each rebuild contains:

- `design.json`: exactly what the agent received.
- `PLAN.md`: the agent's plan.
- `NOTES.md`: every decision the design left open and what the agent chose. It ends with whether the design reminded the agent of a published system it knew.
- The app's source code. Model steps call the local `claude` CLI. Dependencies, build output, generated media and model weights are left out.

Each system's page on the website links to its three rebuilds.
