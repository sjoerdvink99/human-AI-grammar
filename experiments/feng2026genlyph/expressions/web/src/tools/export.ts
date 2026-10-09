import type { ExportRequest } from '../types';
import { loadImage, svgToDataUrl } from './svgutil';

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** [tool_3 translate] fgv_1 + export_request_1 -> fgv_png_1 (or SVG file) */
export async function exportFGV(svg: string, request: ExportRequest, scale = 2): Promise<void> {
  if (request === 'svg') return download(new Blob([svg], { type: 'image/svg+xml' }), 'fgv.svg');
  const w = Number((svg.match(/width="(\d+)"/) || [])[1] || 800);
  const h = Number((svg.match(/height="(\d+)"/) || [])[1] || 600);
  const img = await loadImage(svgToDataUrl(svg));
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  download(blob, 'fgv.png');
}
