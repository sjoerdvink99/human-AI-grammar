// [tool_3 translate] fgv_1 + export_request_1 -> fgv_png_1
import type { Fgv } from './fgv';
import { svgToPng } from './svg';

export type ExportScale = 1 | 2 | 4;

export async function exportPng(fgv: Fgv, scale: ExportScale): Promise<Blob> {
  // the nested glyph <svg>s and pattern defs are self-contained, so the browser can rasterise directly
  return svgToPng(fgv.svg, fgv.width * scale, fgv.height * scale);
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
