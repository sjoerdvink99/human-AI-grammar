import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { router } from './routes.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', router);

if (process.env.NODE_ENV === 'production') {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
