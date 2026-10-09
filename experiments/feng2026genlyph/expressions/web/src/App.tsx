import { actions, useStore } from './store';
import { ConceptView, DataView } from './views/IdeateViews';
import { SegmentView } from './views/SegmentView';
import { AssembleView, FragmentsView, LayoutView } from './views/BuildViews';

const TABS = ['Data & Ideas', 'Concept & Pick', 'Segment & Map', 'Categorical Fragments', 'Assemble', 'Layout & Export'];

export default function App() {
  const s = useStore();
  const enabled = [
    true,
    s.candidateRounds.length > 0 || s.keywords.length > 0,
    !!s.glyphImage,
    s.fragments.length > 0,
    s.glyphs.length > 0,
    s.glyphs.length > 0 && s.layoutRecommendation.length > 0,
  ];
  const View = [DataView, ConceptView, SegmentView, FragmentsView, AssembleView, LayoutView][s.tab];
  return (
    <div className="app">
      <header>
        <h1>System X <span>· pictorial glyph designer</span></h1>
        <nav>
          {TABS.map((t, i) => (
            <button key={t} className={s.tab === i ? 'tab on' : 'tab'} disabled={!enabled[i]} onClick={() => actions.setTab(i)}>
              {i + 1}. {t}
            </button>
          ))}
        </nav>
        {s.glyphImage && <div className="current" title="current glyph image" dangerouslySetInnerHTML={{ __html: s.glyphImage }} />}
      </header>
      {s.error && <div className="error" onClick={actions.clearError}>⚠ {s.error} <small>(click to dismiss)</small></div>}
      <main><View /></main>
    </div>
  );
}
