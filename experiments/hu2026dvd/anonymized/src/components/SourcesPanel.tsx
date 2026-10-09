import { useApp } from "../App";
import { EXAMPLE } from "../example";
import { parseTable } from "../../shared/table";
import type { TextItem } from "../../shared/types";
import { fileToDataUrl } from "../tools/raster";
import { uid } from "../state";

function TextList({
  title, hint, items, onChange, prefix,
}: { title: string; hint: string; items: TextItem[]; onChange: (v: TextItem[]) => void; prefix: string }) {
  return (
    <section className="block">
      <div className="block-head">
        <h3>{title}</h3>
        <button className="ghost small" onClick={() => onChange([...items, { id: uid(prefix), title: "", text: "" }])}>
          + Add
        </button>
      </div>
      <p className="muted">{hint}</p>
      {items.map((it) => (
        <div key={it.id} className="text-item">
          <div className="row">
            <input
              placeholder="Title"
              value={it.title}
              onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, title: e.target.value } : x)))}
            />
            <button className="icon" title="Remove" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
              ×
            </button>
          </div>
          <textarea
            rows={4}
            placeholder="Text"
            value={it.text}
            onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
          />
        </div>
      ))}
    </section>
  );
}

/** Left column: inputs of process 1 (r1, r2*, r3*) and the source images r8* used by process 2. */
export function SourcesPanel({ onGenerate, busy, error }: { onGenerate: () => void; busy: boolean; error: string | null }) {
  const { state, dispatch } = useApp();
  const set = (patch: Partial<typeof state>) => dispatch({ type: "set", patch });

  async function addImages(files: FileList | null) {
    if (!files) return;
    const added = await Promise.all(
      Array.from(files).map(async (f) => ({
        id: uid("img"),
        name: f.name,
        caption: f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
        docId: state.documents[0]?.id ?? "",
        dataUrl: await fileToDataUrl(f),
      })),
    );
    set({ sourceImages: [...state.sourceImages, ...added] });
  }

  const canGenerate = state.brief.trim() && state.documents.some((d) => d.text.trim());

  return (
    <aside className="sources">
      <div className="block-head">
        <h2>Sources</h2>
        <button
          className="ghost small"
          onClick={() =>
            set({
              brief: EXAMPLE.brief,
              styleRefs: EXAMPLE.styleRefs,
              documents: EXAMPLE.documents,
              tableText: EXAMPLE.table,
              table: parseTable(EXAMPLE.table),
            })
          }
        >
          Load example
        </button>
      </div>

      <section className="block">
        <h3>Brief</h3>
        <textarea
          rows={4}
          placeholder="What should the infographic communicate, for whom?"
          value={state.brief}
          onChange={(e) => set({ brief: e.target.value })}
        />
      </section>

      <TextList
        title="Style references"
        hint="Describe palette, tone, layout examples."
        prefix="s"
        items={state.styleRefs}
        onChange={(styleRefs) => set({ styleRefs })}
      />
      <TextList
        title="Source documents"
        hint="Facts are quoted from these and stay linked."
        prefix="d"
        items={state.documents}
        onChange={(documents) => set({ documents })}
      />

      <section className="block">
        <div className="block-head">
          <h3>Source images</h3>
          <label className="ghost small filebtn">
            + Upload
            <input type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
          </label>
        </div>
        <p className="muted">Shown as provenance for elements that cite the attached document or match the caption.</p>
        {state.sourceImages.map((img) => (
          <div key={img.id} className="img-item">
            <img src={img.dataUrl} alt={img.caption} />
            <div className="grow">
              <input
                value={img.caption}
                placeholder="Caption"
                onChange={(e) =>
                  set({ sourceImages: state.sourceImages.map((x) => (x.id === img.id ? { ...x, caption: e.target.value } : x)) })
                }
              />
              <select
                value={img.docId}
                onChange={(e) =>
                  set({ sourceImages: state.sourceImages.map((x) => (x.id === img.id ? { ...x, docId: e.target.value } : x)) })
                }
              >
                <option value="">(no document)</option>
                {state.documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title || d.id}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="icon"
              onClick={() => set({ sourceImages: state.sourceImages.filter((x) => x.id !== img.id) })}
            >
              ×
            </button>
          </div>
        ))}
      </section>

      <div className="generate">
        <button className="primary" disabled={!canGenerate || busy} onClick={onGenerate}>
          {busy ? "Generating elements…" : state.elements.length ? "Regenerate elements" : "Generate elements"}
        </button>
        {state.elements.length > 0 && !busy && (
          <p className="muted small">Regenerating replaces the current elements; earlier rounds stay in the Gallery.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </aside>
  );
}
