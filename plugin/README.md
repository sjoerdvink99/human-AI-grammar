# human-ai — Claude Code plugin for the Human-AI grammar

```
/plugin marketplace add sjoerdvink99/human-AI-grammar
/plugin install human-ai@human-ai-grammar
```

| Skill | Use |
| --- | --- |
| `/human-ai:extract <paper>` | extract validated grammar records from research papers |
| `/human-ai:design <goal>` | design a system in conversation, drawing on the corpus, and get a website link |
| `/human-ai:implement <design>` | implement a design from the website's Design page, a `design.json`, or an expression |
| `grammar` | notation reference and CLI, loaded automatically |

`scripts/human-ai.mjs` is built from the website's grammar and design modules with the corpus bundled. Rebuild it with `npm run plugin:build` after changing `src/domain` or `corpus/`.
