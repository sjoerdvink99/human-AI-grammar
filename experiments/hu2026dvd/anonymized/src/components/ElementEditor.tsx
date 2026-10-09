import { useApp } from "../App";
import { sanitizeColor, sanitizeSvg } from "../../shared/sanitize";
import { ELEMENT_KINDS, type ElementKind, type VisualElement } from "../../shared/types";

/** Process 3 — [human modify]: direct editing of one element record (r4_1 → r4_2). */
export function ElementEditor({ el }: { el: VisualElement }) {
  const { dispatch } = useApp();
  const up = (patch: Partial<VisualElement>) => dispatch({ type: "updateElement", id: el.id, patch });
  const num = (k: "x" | "y" | "w" | "h") => (
    <label className="num">
      {k}
      <input type="number" value={el[k]} onChange={(e) => up({ [k]: Number(e.target.value) || 0 })} />
    </label>
  );
  const textKind = el.kind === "headline" || el.kind === "text" || el.kind === "annotation";
  return (
    <section className="editor">
      <h3>Edit element</h3>
      <label>
        Name
        <input value={el.name} onChange={(e) => up({ name: e.target.value })} />
      </label>
      <div className="row">
        <label className="grow">
          Kind
          <select value={el.kind} onChange={(e) => up({ kind: e.target.value as ElementKind })}>
            {ELEMENT_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Color
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(el.color) ? el.color : "#4f6d7a"} onChange={(e) => up({ color: sanitizeColor(e.target.value) })} />
        </label>
      </div>
      {textKind && (
        <label>
          Text
          <textarea rows={3} value={el.text} onChange={(e) => up({ text: e.target.value })} />
        </label>
      )}
      <label>
        Description
        <textarea rows={2} value={el.description} onChange={(e) => up({ description: e.target.value })} />
      </label>
      <div className="row nums">
        {num("x")}
        {num("y")}
        {num("w")}
        {num("h")}
      </div>
      {!textKind && (
        <details>
          <summary>SVG markup (0 0 100 100)</summary>
          <textarea
            rows={6}
            className="mono"
            value={el.svg}
            onChange={(e) => up({ svg: e.target.value })}
            onBlur={(e) => up({ svg: sanitizeSvg(e.target.value) })}
          />
        </details>
      )}
      <button className="danger small" onClick={() => dispatch({ type: "deleteElement", id: el.id })}>
        Delete element
      </button>
    </section>
  );
}
