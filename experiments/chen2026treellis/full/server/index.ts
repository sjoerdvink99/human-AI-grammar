import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callModel, extractJson } from './model.ts';
import { composeGenerationInput, composeScopedInput, type GenerationInput } from './compose.ts';
import { extractSubtree, findNode, normalizeScene, patchSubtree, SceneError, type Scene } from '../src/shared/scene.ts';

const app = express();
app.use(express.json({ limit: '4mb' }));

/**
 * Run a model step and validate its output; on invalid output, retry once with the
 * validation problems appended so the model can repair its reply.
 */
async function callValidated<T>(input: GenerationInput, validate: (raw: unknown) => T): Promise<T> {
  let user = input.user;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await callModel({ system: input.system, user });
    try {
      return validate(extractJson(reply.text));
    } catch (e) {
      lastErr = e;
      const problems = e instanceof SceneError ? e.problems.join('\n- ') : (e as Error).message;
      user = `${input.user}\n\nYour previous reply was invalid:\n- ${problems}\nReturn a corrected JSON object only.`;
      console.warn(`[model] invalid output (attempt ${attempt + 1}):`, problems.slice(0, 300));
    }
  }
  throw lastErr;
}

// Process 1 ([tool compose] -> [model generate]~) and process 6 (same, with current scene as context).
app.post('/api/generate', async (req, res) => {
  const { prompt, currentScene } = req.body as { prompt?: string; currentScene?: unknown };
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt is empty' });
  try {
    const current = currentScene ? normalizeScene(currentScene) : undefined;
    const generationInput = composeGenerationInput(prompt, current);
    const scene = await callValidated(generationInput, normalizeScene);
    res.json({ scene });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: (e as Error).message });
  }
});

// Process 5: [tool extract] -> [tool compose] -> [model modify]~ -> [tool modify]
app.post('/api/edit-node', async (req, res) => {
  const { scene: rawScene, targetId, request } = req.body as { scene?: unknown; targetId?: string; request?: string };
  if (!request || !request.trim()) return res.status(400).json({ error: 'Change description is empty' });
  try {
    const scene: Scene = normalizeScene(rawScene);
    if (!targetId || !findNode(scene, targetId)) return res.status(400).json({ error: 'Selected node not found' });
    const subtree = extractSubtree(scene, targetId); // subtree_1
    const scopedInput = composeScopedInput(scene, targetId, subtree, request);
    // subtree_2 is validated by patching it into the scene; only that region changes.
    const patched = await callValidated(scopedInput, (fragment) => patchSubtree(scene, targetId, fragment));
    res.json({ scene: patched, subtree: extractSubtree(patched, targetId) });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: (e as Error).message });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
