import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatErrors, parseProgram } from '../shared/dsl';
import { spliceSnippet } from '../shared/edit';
import { callModel } from './model';
import {
  composeGenerateRequest, composeSnippetRequest, extractCodeBlock, generatePrompt, snippetPrompt,
} from './compose';

const app = express();
app.use(express.json({ limit: '1mb' }));

const MAX_ATTEMPTS = 2; // one retry with the parser's errors fed back

function abortOnClose(req: express.Request, res: express.Response): AbortSignal {
  const ctl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
  return ctl.signal;
}

/**
 * Process 1: tool compose (r1 → r2_1) + model generate~ (r2_1 → r3_1).
 * Process 6: tool compose (r16 + r3_1 → r2_2) + model generate~ (r2_2 → r3_2).
 */
app.post('/api/generate', async (req, res) => {
  const { instruction, current_code } = req.body ?? {};
  if (typeof instruction !== 'string' || !instruction.trim())
    return res.status(400).json({ error: 'instruction is required' });
  const signal = abortOnClose(req, res);
  const r2 = composeGenerateRequest(instruction.trim(), typeof current_code === 'string' ? current_code : undefined);
  let { system, prompt } = generatePrompt(r2);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const answer = await callModel({ system, prompt, signal });
      const code = extractCodeBlock(answer);
      const parsed = parseProgram(code);
      if (parsed.ok) return res.json({ code, request: r2, attempts: attempt });
      if (attempt === MAX_ATTEMPTS)
        return res.status(422).json({ error: `model output did not parse:\n${formatErrors(parsed.errors)}`, code });
      prompt += `\n\nYour previous answer:\n\`\`\`shape\n${code}\n\`\`\`\nhad these errors:\n${formatErrors(parsed.errors)}\nReturn the corrected complete program.`;
    }
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: (e as Error).message });
  }
});

/** Process 5: tool compose (→ r15) + model modify~ (r15 → r14_2). Splicing (tool modify) happens in the client. */
app.post('/api/modify-snippet', async (req, res) => {
  const { instruction, snippet, code, selection } = req.body ?? {};
  if (typeof instruction !== 'string' || !instruction.trim() || typeof snippet !== 'string' ||
      typeof code !== 'string' || !selection || typeof selection.start_line !== 'number')
    return res.status(400).json({ error: 'instruction, snippet, code and selection are required' });
  const signal = abortOnClose(req, res);
  const r15 = composeSnippetRequest(instruction.trim(), snippet, selection, code);
  let { system, prompt } = snippetPrompt(r15);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const answer = await callModel({ system, prompt, signal });
      const newSnippet = extractCodeBlock(answer);
      // validate r14_2 by test-splicing it into a copy of r3_1
      const bad = /^\s*(canvas|param)\b/m.test(newSnippet)
        ? [{ line: 0, message: 'snippet must not contain canvas or param lines' }]
        : (() => {
            const p = parseProgram(spliceSnippet(code, selection.start_line, selection.end_line, newSnippet));
            return p.ok ? null : p.errors;
          })();
      if (!bad) return res.json({ snippet: newSnippet, request: r15, attempts: attempt });
      if (attempt === MAX_ATTEMPTS)
        return res.status(422).json({ error: `model output did not fit the program:\n${formatErrors(bad)}`, snippet: newSnippet });
      prompt += `\n\nYour previous answer:\n\`\`\`shape\n${newSnippet}\n\`\`\`\nproduced these errors once spliced into the program (line numbers refer to the full program):\n${formatErrors(bad)}\nReturn the corrected replacement lines only.`;
    }
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: (e as Error).message });
  }
});

const dist = join(process.cwd(), 'dist');
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
