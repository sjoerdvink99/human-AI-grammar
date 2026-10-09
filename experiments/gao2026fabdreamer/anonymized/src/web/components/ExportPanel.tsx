// P11: r27 + r38 → [tool_1 translate] r43* (OpenSCAD) + r44* (drawings) → [human select] r45 → [tool_1 compose] r46.
import { useMemo, useState } from "react";
import { useApp, currentAssembly } from "../store";
import { p11Compose, p11Translate } from "../pipelines";
import { Empty, Step, SvgImage, download } from "./common";
import type { ExportBundle, ExportFormat } from "../../shared/types";

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "openscad", label: "OpenSCAD", hint: "assembly + one file per part" },
  { id: "drawings", label: "Drawings", hint: "dimensioned SVG per part" },
  { id: "full", label: "Full package", hint: "code, drawings, BOM, assembly JSON" },
];

export function ExportPanel() {
  const s = useApp();
  const asm = currentAssembly(s);
  const translated = useMemo(() => p11Translate(), [asm, s.constraints]); // eslint-disable-line react-hooks/exhaustive-deps
  const [format, setFormat] = useState<ExportFormat | null>(null);
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [file, setFile] = useState(0);
  if (!asm || !translated) return <div className="panel"><Empty>Compose an assembly first.</Empty></div>;

  return (
    <div className="panel two-col">
      <div>
        <Step id="r43*" actor="tool_1" title="OpenSCAD code">
          <div className="tabs-inline">
            {translated.scad.map((f, i) => <button key={f.name} className={i === file ? "chip active" : "chip"} onClick={() => setFile(i)}>{f.name.split("/").pop()}</button>)}
          </div>
          <pre className="code">{highlightScad(translated.scad[Math.min(file, translated.scad.length - 1)]?.content ?? "")}</pre>
        </Step>
      </div>
      <div>
        <Step id="r44*" actor="tool_1" title="Part drawings">
          <div className="gallery">
            {translated.drawings.map((d) => (
              <figure key={d.name}><SvgImage svg={d.content} size={160} /><figcaption>{d.name.split("/").pop()}</figcaption></figure>
            ))}
          </div>
        </Step>
        <Step id="r45 → r46" actor="human / tool_1" title="Export">
          <div className="row">
            {FORMATS.map((f) => (
              <button key={f.id} className={format === f.id ? "chip active" : "chip"} title={f.hint}
                onClick={() => { setFormat(f.id); setBundle(p11Compose(f.id)); }}>{f.label}</button>
            ))}
          </div>
          {bundle && (
            <>
              <p className="small">{bundle.files.length} files, {bundle.bom.length} parts · {bundle.createdAt}</p>
              <div className="row">
                <button className="primary" onClick={() => download(`${bundle.name.replace(/\W+/g, "_")}_${bundle.format}.json`, JSON.stringify(bundle, null, 2), "application/json")}>Download bundle (JSON)</button>
              </div>
              <ul className="small files">
                {bundle.files.map((f) => <li key={f.name}><button className="link" onClick={() => download(f.name, f.content, f.mime)}>{f.name}</button></li>)}
              </ul>
            </>
          )}
        </Step>
      </div>
    </div>
  );
}

/** Minimal OpenSCAD syntax highlighting. */
function highlightScad(src: string) {
  return src.split("\n").map((line, i) => {
    const comment = line.indexOf("//");
    const code = comment >= 0 ? line.slice(0, comment) : line;
    const parts = code.split(/(\b(?:module|translate|rotate|cube|cylinder|color|center|true|false)\b|-?\d+(?:\.\d+)?)/g);
    return (
      <div key={i}>
        {parts.map((p, j) => /^(module|translate|rotate|cube|cylinder|color|center|true|false)$/.test(p) ? <span key={j} className="kw">{p}</span>
          : /^-?\d/.test(p) ? <span key={j} className="num">{p}</span> : p)}
        {comment >= 0 && <span className="cm">{line.slice(comment)}</span>}
      </div>
    );
  });
}
