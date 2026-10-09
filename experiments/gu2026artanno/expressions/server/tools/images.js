// Rendering helpers: encode artworks_1 (visual) for a model as a contact sheet of unit crops.
import sharp from 'sharp';
import path from 'node:path';
import { IMAGE_DIR, CROP_DIR } from '../store.js';

export const imagePathFor = (artworks) => (artworkId) => path.join(IMAGE_DIR, artworks.find((a) => a.id === artworkId).file);

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * One row per group: a caption and up to `perRow` unit crops. Returns the file path of the PNG.
 * @param {{caption:string, units:{unitId:string,artworkId:string,x:number,y:number,w:number,h:number}[]}[]} groups
 */
export async function contactSheet(groups, artworks, name, perRow = 8) {
  const cell = 96, capH = 22, pad = 6;
  const width = pad + perRow * (cell + pad);
  const height = groups.length * (capH + cell + pad) + pad;
  const toPath = imagePathFor(artworks);
  const composites = [];
  let y = pad;
  for (const g of groups) {
    composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${capH}"><text x="${pad}" y="16" font-family="Helvetica" font-size="14" fill="#111">${esc(g.caption)}</text></svg>`), top: y, left: 0 });
    y += capH;
    let x = pad;
    for (const u of g.units.slice(0, perRow)) {
      const buf = await sharp(toPath(u.artworkId)).extract({ left: u.x, top: u.y, width: u.w, height: u.h })
        .resize(cell, cell, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      composites.push({ input: buf, top: y, left: x });
      x += cell + pad;
    }
    y += cell + pad;
  }
  const file = path.join(CROP_DIR, `${name}.png`);
  await sharp({ create: { width, height: Math.max(height, 10), channels: 3, background: '#f4f4f4' } }).composite(composites).png().toFile(file);
  return file;
}
