// tool_1 execute: renders simulation code live in a sandboxed iframe.
// A small runner script is injected so the app can run UI tests (process 4) and
// find the elements inside a selected region (processes 5, 7, 8).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type { RegionElement, TestStep } from "../../shared/types";

export const FRAME_W = 900;
export const FRAME_H = 640;

const RUNNER = `<script>(function(){
var post=function(m){parent.postMessage(Object.assign({__sx:1},m),'*')};
window.addEventListener('error',function(e){post({type:'error',message:e.message})});
window.alert=window.confirm=window.prompt=function(){};
var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
function flash(el){if(!el)return;var o=el.style.outline;el.style.outline='3px solid #f59e0b';setTimeout(function(){el.style.outline=o},700)}
window.addEventListener('message',async function(ev){var d=ev.data||{};
 if(d.type==='sx:elements'){var r=d.rect,out=[];
  document.querySelectorAll('body *').forEach(function(el){if(out.length>=40||el.tagName==='SCRIPT'||el.tagName==='STYLE')return;
   var b=el.getBoundingClientRect();if(!b.width||!b.height)return;
   var ix=Math.max(0,Math.min(b.right,r.x+r.w)-Math.max(b.left,r.x)),iy=Math.max(0,Math.min(b.bottom,r.y+r.h)-Math.max(b.top,r.y));
   if(ix*iy<0.25*Math.min(b.width*b.height,r.w*r.h))return;
   var uin=el.getAttribute('data-ui-node')||(el.closest('[data-ui-node]')||{getAttribute:function(){return ''}}).getAttribute('data-ui-node')||'';
   if(!el.id&&!el.getAttribute('data-ui-node')&&el.children.length>0)return;
   out.push({tag:el.tagName.toLowerCase(),id:el.id||'',ui_node:uin,classes:String(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className||''),text:(el.innerText||el.textContent||'').trim().slice(0,80),rect:{x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}});});
  post({type:'elements',reqId:d.reqId,elements:out});}
 if(d.type==='sx:runTest'){var log=[];
  for(var i=0;i<d.steps.length;i++){var s=d.steps[i];try{
   if(s.action==='wait'){await sleep(Math.min(Number(s.value||500),3000));log.push('wait '+s.value+'ms');continue}
   var el=document.querySelector(s.selector);if(!el)throw new Error('no element matches '+s.selector);flash(el);
   if(s.action==='click'){el.click();log.push('clicked '+s.selector)}
   else if(s.action==='set_value'){if(el.type==='checkbox')el.checked=(String(s.value)==='true');else el.value=String(s.value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));log.push('set '+s.selector+' = '+s.value)}
   else if(s.action==='read_text'){log.push('read '+s.selector+' → '+((el.innerText||el.value||'').slice(0,120)))}
  }catch(e){log.push('✗ step '+(i+1)+': '+e.message)}await sleep(600)}
  post({type:'testDone',reqId:d.reqId,log:log});}
});})();<\/script>`;

function inject(html: string) {
  const i = html.search(/<\/body>/i);
  return i >= 0 ? html.slice(0, i) + RUNNER + html.slice(i) : html + RUNNER;
}

export interface FrameHandle {
  runTest: (steps: TestStep[]) => Promise<string[]>;
  elementsInRect: (rect: { x: number; y: number; w: number; h: number }) => Promise<RegionElement[]>;
}

interface Props {
  html: string;
  overlay?: ReactNode;
  onRuntimeError?: (msg: string) => void;
}

export const SimulationFrame = forwardRef<FrameHandle, Props>(function SimulationFrame({ html, overlay, onRuntimeError }, ref) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<number, (d: any) => void>());
  const seq = useRef(0);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setErrors([]);
  }, [html]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframe.current?.contentWindow || !ev.data?.__sx) return;
      const d = ev.data;
      if (d.type === "error") {
        setErrors((e) => [...e.slice(-4), d.message]);
        onRuntimeError?.(d.message);
      } else if (pending.current.has(d.reqId)) {
        pending.current.get(d.reqId)!(d);
        pending.current.delete(d.reqId);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onRuntimeError]);

  const request = (msg: object, timeoutMs: number) =>
    new Promise<any>((resolve, reject) => {
      const reqId = ++seq.current;
      pending.current.set(reqId, resolve);
      iframe.current?.contentWindow?.postMessage({ ...msg, reqId }, "*");
      setTimeout(() => {
        if (pending.current.delete(reqId)) reject(new Error("simulation did not respond"));
      }, timeoutMs);
    });

  useImperativeHandle(ref, () => ({
    runTest: async (steps) => (await request({ type: "sx:runTest", steps }, 60000)).log,
    elementsInRect: async (rect) => (await request({ type: "sx:elements", rect }, 5000)).elements,
  }));

  return (
    <div className="sim-wrap">
      <div className="sim-frame" style={{ width: FRAME_W, height: FRAME_H }}>
        <iframe ref={iframe} title="simulation" sandbox="allow-scripts" srcDoc={inject(html)} width={FRAME_W} height={FRAME_H} />
        {overlay}
      </div>
      {errors.length > 0 && (
        <div className="error small">
          Runtime errors: {errors.join(" · ")}
        </div>
      )}
    </div>
  );
});
