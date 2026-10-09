import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ops from './operations.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(root, 'public')));

// One endpoint per model operation: POST /api/model/<operationName>
const MODEL_OPS = [
  'extractCharacters', 'selectTemplate', 'assignRegionLabels', 'generateObjects', 'assignAffordances',
  'generateProfile', 'generateTraits',
  'extractEvents', 'composeScripts', 'assignScripts',
  'suggestActions', 'characterReply', 'improviseNarration',
];
for (const name of MODEL_OPS) {
  app.post(`/api/model/${name}`, async (req, res) => {
    try {
      res.json(await ops[name](req.body || {}));
    } catch (e) {
      console.error(`[${name}]`, e.message);
      res.status(e.status || 500).json({ error: e.message });
    }
  });
}

const port = Number(process.env.PORT || 5173);
app.listen(port, () => console.log(`Story World running at http://localhost:${port}`));
