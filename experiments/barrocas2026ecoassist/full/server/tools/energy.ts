import type { EnergyEstimate, MeasureResult, WebCode } from "../../shared/types.ts";
import { exclusive, getBrowser, loadPage, screenshot } from "./browser.ts";

/**
 * tool_2: CPU and GPU energy profiling.
 *
 * Without root access to RAPL / powermetrics we estimate energy from the CPU time
 * Chromium reports per process (CDP SystemInfo.getProcessInfo):
 *   - renderer processes → CPU work (parse, script, style, layout, paint)
 *   - GPU process        → compositing / rasterization work (GPU proxy)
 * plus transferred bytes. Power constants are documented assumptions.
 */
export const POWER_MODEL = {
  cpuWatts: 12, // one active laptop performance core
  gpuWatts: 18, // GPU process activity, weighted higher for raster/composite
  joulesPerByte: 2e-7, // device-side network energy
};

interface ProcInfo {
  type: string;
  id: number;
  cpuTime: number;
}

async function processTimes(): Promise<ProcInfo[]> {
  const { cdp } = await getBrowser();
  const r = (await cdp.send("SystemInfo.getProcessInfo" as never)) as { processInfo: ProcInfo[] };
  return r.processInfo;
}

function delta(before: ProcInfo[], after: ProcInfo[], type: (t: string) => boolean): number {
  const prev = new Map(before.map((p) => [p.id, p.cpuTime]));
  return after.filter((p) => type(p.type)).reduce((s, p) => s + Math.max(0, p.cpuTime - (prev.get(p.id) ?? 0)), 0);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface MeasureOptions {
  windowMs?: number;
  runs?: number;
}

/**
 * tool_1 execute + tool_2 evaluate: load the page (rendering) and profile energy
 * over load + an observation window. Returns the median over `runs`.
 */
export async function measure(code: WebCode, { windowMs = 2000, runs = 3 }: MeasureOptions = {}): Promise<MeasureResult> {
  return exclusive(async () => {
    const { browser } = await getBrowser();
    const samples: EnergyEstimate[] = [];
    let rendering: MeasureResult["rendering"] | null = null;
    for (let i = 0; i < runs; i++) {
      const before = await processTimes();
      const p = await loadPage(code, browser);
      await p.page.waitForTimeout(windowMs);
      const after = await processTimes();
      const renderer = delta(before, after, (t) => t === "renderer");
      const gpu = delta(before, after, (t) => t === "GPU");
      const cpuJoules = renderer * POWER_MODEL.cpuWatts;
      const gpuJoules = gpu * POWER_MODEL.gpuWatts;
      const networkJoules = p.transferBytes * POWER_MODEL.joulesPerByte;
      samples.push({
        joules: cpuJoules + gpuJoules + networkJoules,
        cpuJoules,
        gpuJoules,
        networkJoules,
        rendererCpuSeconds: renderer,
        gpuCpuSeconds: gpu,
        transferBytes: p.transferBytes,
        windowMs,
        runs,
      });
      if (!rendering) rendering = { screenshot: await screenshot(p.page), consoleErrors: p.consoleErrors, loadMs: p.loadMs };
      await p.close();
    }
    const pick = (k: keyof EnergyEstimate) => median(samples.map((s) => s[k] as number));
    const energy: EnergyEstimate = {
      joules: pick("joules"),
      cpuJoules: pick("cpuJoules"),
      gpuJoules: pick("gpuJoules"),
      networkJoules: pick("networkJoules"),
      rendererCpuSeconds: pick("rendererCpuSeconds"),
      gpuCpuSeconds: pick("gpuCpuSeconds"),
      transferBytes: pick("transferBytes"),
      windowMs,
      runs,
    };
    return { rendering: rendering!, energy };
  });
}

/** tool_2 evaluate on its own (rendering already obtained). Alias kept for traceability. */
export const profileEnergy = measure;
