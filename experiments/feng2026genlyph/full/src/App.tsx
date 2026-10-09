import { runCategoricalPipeline } from './pipelines';
import { useStore } from './store';
import { AssemblePanel } from './panels/AssemblePanel';
import { ArrangePanel } from './panels/ArrangePanel';
import { ConceptsPanel } from './panels/ConceptsPanel';
import { EncodePanel } from './panels/EncodePanel';
import { RefinePanel } from './panels/RefinePanel';
import { SegmentPanel } from './panels/SegmentPanel';
import { defaultAssembly, extractContours } from './tools/tool3';

const STEPS = [
  { n: 1, title: 'Concepts', sub: 'data → keywords → images' },
  { n: 2, title: 'Refine & select', sub: 'concept → prototype' },
  { n: 3, title: 'Segment & map', sub: 'parts → attributes' },
  { n: 4, title: 'Categorical', sub: 'colour & texture variants' },
  { n: 5, title: 'Assemble', sub: 'numbers → size / copies' },
  { n: 6, title: 'Arrange & export', sub: 'placement → PNG' },
];

export function App() {
  const { s, set, get } = useStore();
  const enabled = (n: number) =>
    n === 1 || (n === 2 && s.keywords.length > 0) || (n === 3 && !!s.glyphImage) || (n === 4 && s.fragments.length > 0)
    || (n >= 5 && !!s.assembly);

  function toAssembly() {
    const st = get();
    // [tool_3 extract] -> fragment_contours_1*
    const contours = extractContours(st.glyphImage!, st.masks);
    const prev = st.assembly;
    const assembly = prev && prev.layerOrder.length === st.masks.length + 1 && st.masks.every((m) => prev.layerOrder.includes(m.id))
      ? prev : defaultAssembly(st.masks, st.mappings);
    set({ contours, assembly, step: 5 });
  }

  return (
    <div className="app">
      <aside className="rail">
        <h1>Figurative<br />Glyph Studio</h1>
        <nav>
          {STEPS.map((st) => (
            <button key={st.n} className={`stepbtn ${s.step === st.n ? 'on' : ''}`} disabled={!enabled(st.n)} onClick={() => set({ step: st.n })}>
              <span className="num">{st.n}</span>
              <span><b>{st.title}</b><small>{st.sub}</small></span>
            </button>
          ))}
        </nav>
        {s.dataset && <p className="rail-foot">{s.dataset.name} · {s.dataset.rows.length} rows</p>}
      </aside>
      <main>
        {s.step === 1 && <ConceptsPanel />}
        {s.step === 2 && <RefinePanel />}
        {s.step === 3 && s.glyphImage && <SegmentPanel onSubmit={() => runCategoricalPipeline(get, set)} />}
        {s.step === 4 && <EncodePanel onNext={toAssembly} />}
        {s.step === 5 && s.assembly && <AssemblePanel onNext={() => set({ step: 6 })} />}
        {s.step === 6 && s.assembly && <ArrangePanel />}
      </main>
    </div>
  );
}
