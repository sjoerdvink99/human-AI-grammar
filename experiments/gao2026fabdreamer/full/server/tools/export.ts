// tool_1 translate / compose: per-layer cut-and-engrave SVGs + PNGs, packaged into a ZIP (process 11).
import fs from 'node:fs';
import sharp from 'sharp';
import JSZip from 'jszip';
import type { Project, Workspace } from '../../shared/types.js';
import { filePath } from '../store.js';
import { elementTransform, layerElements, mmPerPx, texturedLayerSvg } from './layerRender.js';
import { rasterLayer } from './constraints.js';
import { maskToPath } from './vectorize.js';

export interface LayerFiles {
  layerId: string;
  name: string;
  depth: number;
  svgFile: string;
  pngFile: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';

/** [tool_1 translate]  canvas + material_settings → layer_svgs + layer_pngs */
export async function renderLayerFiles(p: Project, ws: Workspace): Promise<LayerFiles[]> {
  const c = ws.canvas!;
  const mm = mmPerPx(ws);
  const Wmm = c.width * mm;
  const Hmm = c.height * mm;
  const out: LayerFiles[] = [];
  const stamp = Date.now();
  for (const layer of [...c.layers].sort((a, b) => a.depth - b.depth)) {
    const factor = 2;
    const r = await rasterLayer(ws, layer.id, factor);
    const cut = maskToPath(r.union, r.W, r.H, 0.6);
    const engrave = layerElements(ws, layer)
      .filter((e) => e.origin !== 'bridge' && e.origin !== 'background')
      .map((e) => `<path d="${e.path}" transform="${elementTransform(e)}"/>`)
      .join('');
    const svg =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Wmm.toFixed(2)}mm" height="${Hmm.toFixed(2)}mm" viewBox="0 0 ${c.width} ${c.height}">\n` +
      `<title>${layer.name} — depth ${layer.depth} — ${ws.material.material} ${ws.material.thicknessMm} mm</title>\n` +
      `<g id="engrave" fill="none" stroke="#0000ff" stroke-width="${(0.1 / mm).toFixed(4)}" fill-rule="evenodd">${engrave}</g>\n` +
      `<g id="cut" fill="none" stroke="#ff0000" stroke-width="${(0.1 / mm).toFixed(4)}" fill-rule="evenodd"><path d="${cut}" transform="scale(${1 / factor})"/></g>\n` +
      `</svg>\n`;
    const base = `export_${stamp}_${String(layer.depth + 1).padStart(2, '0')}-${slug(layer.name)}`;
    fs.writeFileSync(filePath(p.id, `${base}.svg`), svg);
    const tsvg = texturedLayerSvg(p.id, ws, layer, c.width * 2);
    await sharp(Buffer.from(tsvg)).png().toFile(filePath(p.id, `${base}.png`));
    out.push({ layerId: layer.id, name: layer.name, depth: layer.depth, svgFile: `${base}.svg`, pngFile: `${base}.png` });
  }
  return out;
}

/** [tool_1 compose]  layer_svgs + layer_pngs + export_choice → export_zip */
export async function composeZip(p: Project, files: LayerFiles[], choice: { formats: ('svg' | 'png')[]; layerIds: string[] }, ws: Workspace) {
  const zip = new JSZip();
  for (const f of files) {
    if (!choice.layerIds.includes(f.layerId)) continue;
    const name = `${String(f.depth + 1).padStart(2, '0')}-${slug(f.name)}`;
    if (choice.formats.includes('svg')) zip.file(`${name}.svg`, fs.readFileSync(filePath(p.id, f.svgFile)));
    if (choice.formats.includes('png')) zip.file(`${name}.png`, fs.readFileSync(filePath(p.id, f.pngFile)));
  }
  zip.file(
    'README.txt',
    `Layered design export\nMaterial: ${ws.material.material}, ${ws.material.thicknessMm} mm\nSheet width: ${ws.material.sheetWidthMm} mm\n` +
      `Files are numbered front (01) to back. In SVGs, red = cut, blue = engrave (hairline).\n`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
