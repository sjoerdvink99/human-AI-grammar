// tool_1 = the browser runtime: the simulation runs in an <iframe>; these helpers act inside it.
import type { Region, RegionElement, TestCase } from '../../shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** P4 [tool_1 execute]: play a ui_test visibly inside the running simulation; returns a log (ui_test_result). */
export async function playTestInIframe(frame: HTMLIFrameElement, test: TestCase, onLog: (line: string) => void) {
  const doc = frame.contentDocument;
  const win = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!doc || !win) throw new Error('simulation not loaded');
  for (const [i, step] of test.steps.entries()) {
    const label = `${i + 1}. ${step.action} ${step.selector ?? ''} ${step.value ?? ''}`.trim();
    try {
      const el = step.selector ? (doc.querySelector(step.selector) as HTMLElement | null) : null;
      if (step.selector && !el && step.action !== 'wait' && step.action !== 'press') throw new Error('element not found');
      if (el) {
        const prev = el.style.outline;
        el.style.outline = '3px solid #f59e0b';
        el.scrollIntoView?.({ block: 'nearest' });
        setTimeout(() => (el.style.outline = prev), 900);
      }
      switch (step.action) {
        case 'click':
          el!.click();
          break;
        case 'set_value': {
          const input = el as HTMLInputElement;
          if (input.type === 'checkbox' || input.type === 'radio') input.checked = ['true', 'on', '1'].includes(step.value ?? '');
          else input.value = step.value ?? '';
          input.dispatchEvent(new win.Event('input', { bubbles: true }));
          input.dispatchEvent(new win.Event('change', { bubbles: true }));
          break;
        }
        case 'press':
          doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: step.value || 'Enter', bubbles: true }));
          doc.dispatchEvent(new win.KeyboardEvent('keyup', { key: step.value || 'Enter', bubbles: true }));
          break;
        case 'wait':
          await sleep(Math.min(Number(step.value) || 500, 5000));
          break;
        case 'read': {
          const v = el instanceof win.HTMLInputElement ? el.value : (el!.innerText || '').trim().slice(0, 120);
          onLog(`${label} → "${v}"`);
          await sleep(700);
          continue;
        }
      }
      onLog(`${label} ✓`);
    } catch (e) {
      onLog(`${label} ✗ ${(e as Error).message}`);
    }
    await sleep(900);
  }
}

/** Describe the live DOM elements under a freehand region (feeds chat/redraw/subgraph region records). */
export function elementsInRegion(frame: HTMLIFrameElement, bbox: Region['bbox']): RegionElement[] {
  const doc = frame.contentDocument;
  if (!doc) return [];
  const seen = new Set<Element>();
  const out: RegionElement[] = [];
  const stepX = Math.max(8, bbox.w / 8);
  const stepY = Math.max(8, bbox.h / 8);
  for (let x = bbox.x; x <= bbox.x + bbox.w; x += stepX) {
    for (let y = bbox.y; y <= bbox.y + bbox.h; y += stepY) {
      const hit = doc.elementFromPoint(x, y);
      if (!hit || hit === doc.body || hit === doc.documentElement) continue;
      const tagged = (hit.closest('[data-ui-node]') as HTMLElement | null) ?? (hit as HTMLElement);
      if (seen.has(tagged)) continue;
      seen.add(tagged);
      out.push({
        ui_node: tagged.getAttribute('data-ui-node') ?? undefined,
        tag: tagged.tagName.toLowerCase(),
        dom_id: tagged.id || undefined,
        text: (tagged.innerText || tagged.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
      });
    }
  }
  return out;
}
