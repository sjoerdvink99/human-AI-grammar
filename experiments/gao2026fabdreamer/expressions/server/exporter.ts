// Process 11: tool_1 translate (canvas → per-layer SVG cut files + PNGs) and tool_1 compose (zip).
import JSZip from 'jszip';
import type { Canvas, MaterialSettings, StoredSegment } from '../shared/types.ts';
import { renderPng } from './svg.ts';
import { mmPerPx } from './constraints.ts';

export interface LayerExport {
  layerId: string;
  name: string;
  depth: number;
  fileBase: string;
  svg: string; // layer_svgs: artifact formal
  png: Buffer; // layer_pngs: artifact visual
  pieces: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';

/** tool_1 translate: canvas + material_settings → layer_svgs* + layer_pngs* */
export function translateLayers(canvas: Canvas<StoredSegment>, settings: MaterialSettings): LayerExport[] {
  const k = mmPerPx(settings);
  const wmm = settings.artworkWidthMm;
  const hmm = (wmm * canvas.height) / canvas.width;
  const hairline = (0.1 / k).toFixed(3);
  return [...canvas.layers]
    .sort((a, b) => a.depth - b.depth)
    .map((l) => {
      const segs = canvas.segments.filter((s) => s.layerId === l.id);
      const fileBase = `${String(l.depth + 1).padStart(2, '0')}-${slug(l.name)}`;
      const cut = segs
        .map((s) => `  <path id="${s.id}" data-label="${escapeXml(s.label)}" d="${s.path}" transform="translate(${s.dx} ${s.dy})" fill="none" stroke="#ff0000" stroke-width="${hairline}" fill-rule="evenodd"/>`)
        .join('\n');
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${wmm}mm" height="${hmm.toFixed(2)}mm" viewBox="0 0 ${canvas.width} ${canvas.height}">
  <!-- Layer ${l.depth + 1}: ${escapeXml(l.name)} | material ${settings.material} ${settings.thicknessMm} mm | red hairline = cut -->
  <rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="none" stroke="#0000ff" stroke-width="${hairline}"/>
${cut}
</svg>`;
      const fillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">${segs
        .map((s) => `<path d="${s.path}" transform="translate(${s.dx} ${s.dy})" fill="${s.color}" fill-rule="evenodd"/>`)
        .join('')}</svg>`;
      const png = renderPng(fillSvg, 1024, 'rgba(0,0,0,0)');
      return { layerId: l.id, name: l.name, depth: l.depth, fileBase, svg, png, pieces: segs.length };
    });
}

/** tool_1 compose: layer files + export_choice → export_zip */
export async function composeZip(layers: LayerExport[], choice: 'svg' | 'png' | 'both', settings: MaterialSettings, canvasVersion: number): Promise<Buffer> {
  const zip = new JSZip();
  for (const l of layers) {
    if (choice !== 'png') zip.file(`svg/${l.fileBase}.svg`, l.svg);
    if (choice !== 'svg') zip.file(`png/${l.fileBase}.png`, l.png);
  }
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        generator: 'System X layered cut export',
        canvasVersion,
        exportChoice: choice,
        materialSettings: settings,
        stackOrder: 'layer 01 is the back-most sheet',
        layers: layers.map((l) => ({ file: l.fileBase, name: l.name, depth: l.depth, pieces: l.pieces })),
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function escapeXml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}
