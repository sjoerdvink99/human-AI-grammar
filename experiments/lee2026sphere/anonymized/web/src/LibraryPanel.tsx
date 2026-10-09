// r2 (asset library) + r3 (reliability model) view.
import type { Library, Reliability } from '../../shared/types.ts';

export function LibraryPanel({ library, reliability, highlight }: { library: Library; reliability: Reliability; highlight: string[] }) {
  const rel = (id: string) => reliability.weights[id] ?? reliability.prior;
  const learned = library.assets.filter((a) => a.source === 'learned');
  const touched = Object.keys(reliability.weights);
  return (
    <section className="library">
      <h3>Asset library <span className="muted">r2 v{library.version} · {library.assets.length} assets</span></h3>
      <h4>Learned arrangements ({learned.length})</h4>
      {!learned.length && <p className="muted">None yet. Compose and edit a scene, then “Learn from this scene”.</p>}
      <div className="cards">
        {learned.map((a) => (
          <div key={a.id} className={`card ${highlight.includes(a.id) ? 'new' : ''}`}>
            {a.thumbnail && <div className="thumb" dangerouslySetInnerHTML={{ __html: a.thumbnail }} />}
            <b>{a.name}</b>
            <div className="muted small">{a.description}</div>
            <Rel v={rel(a.id)} />
          </div>
        ))}
      </div>
      <h4>Reliability model <span className="muted">r3 v{reliability.version} · prior {reliability.prior}</span></h4>
      {!touched.length ? <p className="muted">Untrained: every asset uses the prior.</p> : (
        <div className="relList">{touched.sort((a, b) => rel(b) - rel(a)).map((id) => <div key={id} className="relRow"><span>{library.assets.find((a) => a.id === id)?.name ?? id}</span><Rel v={rel(id)} /></div>)}</div>
      )}
      <details><summary>Base assets ({library.assets.length - learned.length})</summary>
        <ul className="base">{library.assets.filter((a) => a.source === 'seed').map((a) => <li key={a.id}><i style={{ background: a.color }} />{a.name} <span className="muted">{a.w}×{a.h}</span></li>)}</ul>
      </details>
    </section>
  );
}

const Rel = ({ v }: { v: number }) => <div className="rel" title={`reliability ${v.toFixed(2)}`}><i style={{ width: `${v * 100}%` }} /><b>{v.toFixed(2)}</b></div>;
