import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ops from './ops';
import type { Vignette } from '../shared/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data', 'vignettes');
fs.mkdirSync(dataDir, { recursive: true });

const app = express();
app.use(express.json({ limit: '5mb' }));

/** Wrap an op so errors come back as JSON { error }. */
const route = (fn: (b: any) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
  try { res.json(await fn(req.body)); }
  catch (e: any) { console.error(e); res.status(500).json({ error: e?.message ?? String(e) }); }
};

// Process 1
app.post('/api/p1/extract-characters', route(async (b) => ({ characters: await ops.extractCharacters(b.story) })));
app.post('/api/p1/select-layout', route((b) => ops.selectLayout(b.story, b.characters)));
app.post('/api/p1/assign-room-labels', route(async (b) => ({ roomLabels: await ops.assignRoomLabels(b.story, b.layoutId, b.characters) })));
app.post('/api/p1/generate-objects', route(async (b) => ({ objects: await ops.generateObjects(b.story, b.layoutId, b.characters, b.roomLabels) })));
app.post('/api/p1/assign-objects', route(async (b) => ({ objects: await ops.assignObjectAffordances(b.story, b.environment, b.characters, b.objects) })));
// Process 2
app.post('/api/p2/reply', route(async (b) => ({ reply: await ops.personaReply(b.story, b.characters, b.characterId, b.message) })));
app.post('/api/p2/traits', route(async (b) => ({ traits: await ops.suggestTraits(b.story, b.characters, b.characterId, b.message, b.reply) })));
// Process 3
app.post('/api/p3/extract-activities', route(async (b) => ({ activities: await ops.extractActivities(b.story, b.environment, b.characters) })));
app.post('/api/p3/compose-events', route(async (b) => ({ events: await ops.composeEvents(b.story, b.characters, b.activities) })));
app.post('/api/p3/order-events', route(async (b) => ({ events: await ops.orderEvents(b.story, b.events, b.activities, b.characters) })));
// Process 4–6
app.post('/api/p4/npc-plans', route(async (b) => ({ plans: await ops.planNpcs(b.vignette, b.runtimeState) })));
app.post('/api/p5/npc-reply', route(async (b) => ({ reply: await ops.npcReply(b.vignette, b.runtimeState, b.characterId, b.message) })));
app.post('/api/p6/inner-voice', route(async (b) => ({ innerVoice: await ops.innerVoice(b.vignette, b.runtimeState, b.playerAction) })));

// Vignette storage (output of P3.5, input of P4)
const vpath = (id: string) => path.join(dataDir, `${id.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
app.post('/api/vignettes', (req, res) => {
  const v = req.body as Vignette;
  if (!v?.id) return res.status(400).json({ error: 'missing id' });
  fs.writeFileSync(vpath(v.id), JSON.stringify(v, null, 2));
  res.json({ id: v.id });
});
app.get('/api/vignettes', (_req, res) => {
  const list = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => {
    const v = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')) as Vignette;
    return { id: v.id, title: v.title, createdAt: v.createdAt };
  });
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});
app.get('/api/vignettes/:id', (req, res) => {
  const p = vpath(req.params.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.type('json').send(fs.readFileSync(p, 'utf8'));
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 8790);
app.listen(port, () => console.log(`server on http://localhost:${port}`));
