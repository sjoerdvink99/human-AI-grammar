// npm run seed — writes a fresh state with the synthetic sample collection.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generateCollection } from './artgen.js';
import { emptyState, reset, IMAGE_DIR, CROP_DIR, DATA_DIR } from '../store.js';

export async function seedCollection() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.mkdirSync(CROP_DIR, { recursive: true });
  const s = emptyState();
  for (const art of generateCollection()) {
    const file = path.join(IMAGE_DIR, `${art.id}.png`);
    await sharp(Buffer.from(art.svg)).png().toFile(file);
    s.artworks.push({ id: art.id, title: art.metadata.title, image: `/images/${art.id}.png`, file: `${art.id}.png`, width: 640, height: 480 });
    s.artworkMetadata.push({ artworkId: art.id, ...art.metadata });
  }
  reset(s);
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await seedCollection();
  console.log(`Seeded ${s.artworks.length} artworks with ${s.artworkMetadata.reduce((a, m) => a + m.objects.length, 0)} objects into ${DATA_DIR}`);
}
