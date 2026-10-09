// tool_1 execute (render) and tool_2 execute (test runner): run generated code in a sandboxed iframe.
import { CANVAS, type TestCase, type TestResult } from '../shared/types';

const escScript = (s: string) => s.replace(/<\/script/gi, '<\\/script');
const jsonForScript = (v: unknown) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');

/**
 * Build the srcdoc for a sandboxed run. `data === undefined` uses the program's SAMPLE_DATA.
 * `report` posts errors/svg/stats to the parent after rendering.
 */
export function buildSrcdoc(code: string, data: unknown, runId: string, report: boolean): string {
  const useSample = data === undefined;
  return `<!doctype html><html><head><style>
html,body{margin:0;padding:0;background:#fff;overflow:hidden;font-family:system-ui,sans-serif}
svg{display:block}
</style></head><body>
<svg id="root" xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}"></svg>
<script>
window.__errors=[];window.__logs=[];
window.onerror=function(msg,src,line,col){window.__errors.push(String(msg)+(line?' (line '+line+')':''));return true;};
var _l=console.log,_w=console.warn,_e=console.error;
console.log=function(){window.__logs.push([].map.call(arguments,String).join(' '));_l.apply(console,arguments)};
console.warn=function(){window.__logs.push('warn: '+[].map.call(arguments,String).join(' '));_w.apply(console,arguments)};
console.error=function(){window.__errors.push('console.error: '+[].map.call(arguments,String).join(' '));_e.apply(console,arguments)};
</script>
<script>
${escScript(code)}
</script>
<script>
(function(){
  var root=document.getElementById('root');
  try{
    if(typeof render!=='function') throw new Error('render(svg, data) is not defined');
    var data=${useSample ? "(typeof SAMPLE_DATA!=='undefined'?SAMPLE_DATA:[])" : jsonForScript(data)};
    render(root,data);
  }catch(e){window.__errors.push((e&&e.name?e.name+': ':'')+(e&&e.message?e.message:String(e)));}
  ${
    report
      ? `setTimeout(function(){
    var stats={};var all=root.querySelectorAll('*');
    for(var i=0;i<all.length;i++){var t=all[i].tagName.toLowerCase();stats[t]=(stats[t]||0)+1;}
    stats.total=all.length;
    parent.postMessage({__sandbox:${JSON.stringify(runId)},errors:window.__errors,logs:window.__logs.slice(0,30),stats:stats,svg:new XMLSerializer().serializeToString(root)},'*');
  },250);`
      : ''
  }
})();
</script></body></html>`;
}

let counter = 0;

/** Run code once with given data in a hidden iframe and collect a TestResult-like record. */
export function runOnce(code: string, data: unknown, testId = 'sample', timeoutMs = 4000): Promise<TestResult> {
  return new Promise((resolve) => {
    const runId = `run${++counter}_${Date.now()}`;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.cssText = `position:absolute;left:-10000px;top:0;width:${CANVAS.width}px;height:${CANVAS.height}px;border:0`;
    const done = (r: TestResult) => {
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      iframe.remove();
      resolve(r);
    };
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow || ev.data?.__sandbox !== runId) return;
      const errors: string[] = ev.data.errors ?? [];
      done({ testId, status: errors.length ? 'error' : 'ok', errors, logs: ev.data.logs ?? [], stats: ev.data.stats ?? {}, svg: ev.data.svg ?? '' });
    };
    const timer = setTimeout(
      () => done({ testId, status: 'error', errors: [`timed out after ${timeoutMs} ms (infinite loop or crash?)`], logs: [], stats: {}, svg: '' }),
      timeoutMs,
    );
    window.addEventListener('message', onMsg);
    iframe.srcdoc = buildSrcdoc(code, data, runId, true);
    document.body.appendChild(iframe);
  });
}

/** tool_2 execute: run the program on its sample data → r13* (error messages). */
export async function executeForErrors(code: string): Promise<string[]> {
  const r = await runOnce(code, undefined, 'sample');
  const errs = [...r.errors];
  if (!errs.length && (r.stats.total ?? 0) === 0) errs.push('render produced no SVG elements for SAMPLE_DATA');
  return errs;
}

/** tool_2 execute: run every test case → r15* (records) + r16* (svg snapshots). */
export async function executeTests(code: string, tests: TestCase[]): Promise<TestResult[]> {
  const out: TestResult[] = [];
  for (const t of tests) out.push(await runOnce(code, t.data, t.id));
  return out;
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
