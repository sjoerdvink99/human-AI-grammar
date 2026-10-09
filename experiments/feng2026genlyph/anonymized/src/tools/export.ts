import type { ExportFormat } from "../types.ts";

/** tool_3 translate: r27 + r28 -> r29 (a file blob in the chosen format) */
export async function exportChart(r27: string, r28: ExportFormat): Promise<{ blob: Blob; filename: string }> {
  if (r28 === "svg") return { blob: new Blob([r27], { type: "image/svg+xml" }), filename: "pictorial-chart.svg" };
  const vb = r27.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vb[2] * scale);
  canvas.height = Math.round(vb[3] * scale);
  const ctx = canvas.getContext("2d")!;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([r27], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("could not rasterise SVG"));
      img.src = url;
    });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  const type = r28 === "png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("export failed"))), type, 0.92));
  return { blob, filename: `pictorial-chart.${r28 === "png" ? "png" : "jpg"}` };
}
