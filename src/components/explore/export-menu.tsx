"use client";

import { Download } from "lucide-react";
import { useState, type ReactElement } from "react";
import { Select } from "@/components/ui/field";
import { download, renderDetached, serializeSvg, snapshotSvg, svgToPng } from "./figure-export";

export interface FigureSize {
  width: number;
  height: number;
}

interface Preset {
  label: string;
  inches?: number;
  aspect?: number;
}

const textScale = 8 / 11;
const printDpi = 300;
const screenDpi = 96;
const screenScale = 4;

const presets: Record<string, Preset> = {
  column: { label: "1 column · 3.5 in", inches: 3.5, aspect: 0.78 },
  page: { label: "2 columns · 7 in", inches: 7, aspect: 0.5 },
  screen: { label: "As shown" },
};

function layoutFor({ inches, aspect }: Preset): FigureSize | undefined {
  if (!inches || !aspect) return undefined;
  const width = Math.round((inches * 72) / textScale);
  return { width, height: Math.round(width * aspect) };
}

export function ExportMenu({
  renderFigure,
  screenSize,
  filename,
}: {
  renderFigure: (size: FigureSize) => ReactElement;
  screenSize: () => FigureSize | undefined;
  filename: string;
}) {
  const [preset, setPreset] = useState("column");
  const [busy, setBusy] = useState(false);

  async function exportFigure(format: "svg" | "png") {
    const { inches } = presets[preset];
    const layout = layoutFor(presets[preset]) ?? screenSize();
    if (!layout) return;

    setBusy(true);
    try {
      const snapshot = renderDetached(renderFigure(layout), (host) => snapshotSvg(host.querySelector("svg")!));
      const printedWidth = inches ?? snapshot.width / screenDpi;
      const printedHeight = (printedWidth * snapshot.height) / snapshot.width;
      const name = `${filename}-${preset}`;
      if (format === "svg") {
        const size = inches
          ? { width: `${printedWidth}in`, height: `${printedHeight.toFixed(3)}in` }
          : { width: `${snapshot.width}px`, height: `${snapshot.height}px` };
        download(new Blob([await serializeSvg(snapshot, size)], { type: "image/svg+xml" }), `${name}.svg`);
      } else {
        const dpi = inches ? printDpi : screenDpi * screenScale;
        const width = Math.round(printedWidth * dpi);
        const height = Math.round(printedHeight * dpi);
        const svg = await serializeSvg(snapshot, { width: `${width}`, height: `${height}` });
        download(await svgToPng(svg, width, height, dpi), `${name}.png`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-muted">
      <Download className="size-3.5" aria-hidden />
      <Select value={preset} onChange={(event) => setPreset(event.target.value)} className="h-7 text-xs text-ink" aria-label="Export size">
        {Object.entries(presets).map(([key, { label }]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </Select>
      {(["svg", "png"] as const).map((format) => (
        <button
          key={format}
          type="button"
          disabled={busy}
          onClick={() => exportFigure(format)}
          className="h-7 rounded border border-line-strong px-2 text-ink uppercase hover:bg-wash disabled:opacity-50"
        >
          {format}
        </button>
      ))}
    </div>
  );
}
