// Process 4: Decompose and reconstruct layers (front to back), with process 5 for failed masks,
// ending in process 7's Auto Layout (tool_2 compose).
import fs from 'node:fs';
import type { Element, Project, Workspace } from '../../shared/types.js';
import { autoLayout } from '../../shared/autoLayout.js';
import * as vlm from '../models/vlm.js';
import * as segmenter from '../models/segmenter.js';
import * as imageModel from '../models/imageModel.js';
import { recoverMask } from './recover.js';
import { maskToElement } from '../tools/vectorize.js';
import { compositeMasked, dilate, loadRGBA, maskArea, paintMask, pushPullFill, saveRGBA, type Mask, type RGBA } from '../tools/raster.js';
import { filePath, projectDir, saveProject, uid } from '../store.js';

export async function runDecompose(p: Project, ws: Workspace, log: (s: string) => void) {
  const src = p.sourceVersions.find((v) => v.id === ws.sourceId)!;
  const plan = ws.confirmedLayers!;
  const dir = projectDir(p.id);
  const step = (s: string, detail?: string) => {
    ws.decomposeLog.push({ t: Date.now(), step: s, detail });
    log(s + (detail ? `: ${detail}` : ''));
    saveProject(p);
  };
  ws.decomposeStatus = 'running';
  ws.decomposeLog = [];
  ws.elements = {};
  ws.workImages = [];
  ws.canvas = undefined;
  ws.canvasHistory = [];
  ws.prepare = { issues: [], chat: [] };
  try {
    const srcPath = filePath(p.id, src.file);
    // [model_1 extract] → layer_items ; [model_1 extract] → style
    step('Describing elements (model_1)');
    ws.layerItems = await vlm.describeItems(srcPath, plan);
    step('Describing image style (model_1)');
    ws.style = await vlm.describeStyle(srcPath);
    step('Style', ws.style);

    // [tool_1 modify] → work_image_1 (+ empty segments)
    let work: RGBA = await loadRGBA(srcPath);
    const workFile0 = `${ws.sourceId}_work_0.png`;
    await saveRGBA(work, filePath(p.id, workFile0));
    ws.workImages.push(workFile0);
    step('Initialized work image (tool_1)');

    const layers = [...plan.layers].sort((a, b) => a.depth - b.depth);
    for (let li = 0; li < layers.length - 1; li++) {
      const layer = layers[li];
      const items = ws.layerItems.filter((i) => i.layerId === layer.id);
      if (!items.length) continue;
      const workPath = filePath(p.id, ws.workImages.at(-1)!);

      // [model_1 extract] → detection_prompts
      step(`Layer "${layer.name}": locating ${items.length} element(s) (model_1)`);
      const detections = await vlm.locateElements(workPath, work.width, work.height, items);
      step(`Layer "${layer.name}": ${detections.length} detection(s)`, detections.map((d) => d.label).join(', '));
      if (!detections.length) continue;

      // [model_3 extract] → masks (+ process 5 recovery)
      step(`Layer "${layer.name}": segmenting (model_3)`);
      const results = await Promise.all(
        detections.map(async (d) => {
          const item = items.find((i) => i.id === d.itemId);
          try {
            const m = await segmenter.segment(work, d, dir, item?.visualDetails);
            const r = await recoverMask(work, m, item?.visualDetails ?? '', dir, (s) => step(s));
            return { d, item, ...r };
          } catch (e) {
            step(`Segmentation failed for "${d.label}"`, (e as Error).message.slice(0, 120));
            return null;
          }
        }),
      );

      // [tool_1 translate] → segments_2
      const union = new Uint8Array(work.width * work.height);
      const removed: string[] = [];
      // smaller elements sit on top of larger ones on the same layer: where they overlap, the larger
      // element's texture is repainted from its own surroundings so it doesn't carry the smaller one's pixels
      const ok = results.filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ ...r, area: maskArea(r.mask) }));
      for (const r of ok) {
        const overlap = new Uint8Array(r.mask.length);
        let any = false;
        for (const o of ok) {
          if (o === r || o.area >= r.area) continue;
          for (let i = 0; i < overlap.length; i++)
            if (r.mask[i] && o.mask[i]) {
              overlap[i] = 1;
              any = true;
            }
        }
        const texSource = any ? pushPullFill(work, overlap) : work;
        const el = await maskToElement(p.id, texSource, r.mask, {
          name: r.item?.name ?? r.d.label,
          layerId: layer.id,
          origin: r.quality.stage === 'fallback' ? 'fallback' : 'segment',
          quality: r.quality,
        });
        if (!el) continue;
        ws.elements[el.id] = el;
        removed.push(el.name);
        for (let i = 0; i < union.length; i++) if (r.mask[i]) union[i] = 1;
      }
      step(`Layer "${layer.name}": extracted ${removed.length} element(s) as vector shapes (tool_1)`);
      if (!removed.length) continue;

      // [model_1 generate]~ → fill_prompt ; [model_2 modify]~ → work_image (filled)
      const hole: Mask = dilate(union, work.width, work.height, 3);
      const holeFile = `tmp_hole_${uid()}.png`;
      await saveRGBA(paintMask(work, hole, [255, 0, 255]), filePath(p.id, holeFile));
      const remaining = layers.slice(li + 1).map((l) => l.name);
      let fp = 'Continue the background scene naturally.';
      try {
        fp = await vlm.fillPrompt(filePath(p.id, holeFile), ws.style, removed, remaining);
      } catch (e) {
        step('Fill prompt failed, using default', (e as Error).message.slice(0, 80));
      }
      step(`Layer "${layer.name}": filling removed region (model_2)`, fp);
      const prefill = pushPullFill(work, hole);
      try {
        const patch = await imageModel.inpaintPatch(filePath(p.id, holeFile), work.width, work.height, fp, ws.style);
        work = compositeMasked(prefill, patch, hole);
      } catch (e) {
        step('Inpainting model failed; using smooth pre-fill', (e as Error).message.slice(0, 80));
        work = prefill;
      }
      const wf = `${ws.sourceId}_work_${ws.workImages.length}.png`;
      await saveRGBA(work, filePath(p.id, wf));
      ws.workImages.push(wf);
      step(`Layer "${layer.name}": done`);
    }

    // back layer: the reconstructed remainder becomes the back plate
    const back = layers.at(-1)!;
    const full = new Uint8Array(work.width * work.height).fill(1);
    const bg = await maskToElement(p.id, work, full, { name: back.elements[0]?.name ?? 'Background', layerId: back.id, origin: 'background' });
    if (bg) ws.elements[bg.id] = bg;

    // process 7: [tool_2 compose] Auto Layout → canvas_1
    ws.canvas = autoLayout(plan, ws.elements, work.width, work.height);
    ws.decomposeStatus = 'done';
    step(`Done: ${Object.keys(ws.elements).length} elements on ${plan.layers.length} layers. Auto Layout placed them on the canvas.`);
    cleanupTmp(dir);
  } catch (e) {
    ws.decomposeStatus = 'error';
    step('Decomposition failed', (e as Error).message.slice(0, 300));
    throw e;
  }
}

function cleanupTmp(dir: string) {
  if (process.env.SYSTEMX_KEEP_TMP) return;
  // only remove temp files older than 10 minutes so concurrent jobs keep theirs
  const cutoff = Date.now() - 10 * 60_000;
  for (const f of fs.readdirSync(dir))
    if (f.startsWith('tmp_') && fs.statSync(`${dir}/${f}`).mtimeMs < cutoff) fs.rmSync(`${dir}/${f}`, { force: true });
}

export type { Element };
