import { actions, useStore } from '../store';
import { CandidateGallery, Spinner, WordCloud } from '../components/common';
import type { AttributeKind } from '../types';

/** Process 1: dataset -> attributes -> description -> keywords -> word cloud -> image prompts -> candidate images */
export function DataView() {
  const s = useStore();
  const pendingImages = s.candidateRounds.some((r) => r.images.some((i) => 'pending' in i));
  const onFile = async (f: File | undefined) => {
    if (f) actions.loadCsv(await f.text(), f.name.replace(/\.csv$/i, ''));
  };
  const loadSample = async () => actions.loadCsv(await (await fetch('/data/fruits.csv')).text(), 'fruits');

  return (
    <div className="cols">
      <section className="panel">
        <h2>1 · Dataset</h2>
        <div className="row">
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          <button onClick={loadSample}>Load sample (fruits)</button>
        </div>
        {s.dataset && (
          <>
            <div className="tablewrap">
              <table>
                <thead><tr>{s.dataset.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {s.dataset.rows.slice(0, 50).map((r, i) => (
                    <tr key={i}>{s.dataset!.columns.map((c) => <td key={c}>{String(r[c])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Attributes</h3>
            <table className="attrs">
              <tbody>
                {s.attributes.map((a) => (
                  <tr key={a.name}>
                    <td><b>{a.name}</b></td>
                    <td>
                      <select value={a.kind} onChange={(e) => actions.setAttributeKind(a.name, e.target.value as AttributeKind)}>
                        <option value="numeric">numeric</option>
                        <option value="categorical">categorical</option>
                        <option value="id">identifier</option>
                      </select>
                    </td>
                    <td className="muted">
                      {a.kind === 'numeric' ? `${a.min} – ${a.max}` : a.kind === 'categorical' ? a.categories!.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details>
              <summary>Dataset description sent to the keyword model</summary>
              <pre>{s.datasetDescription}</pre>
            </details>
          </>
        )}
      </section>

      <section className="panel">
        <h2>2 · Keywords</h2>
        <button className="primary" disabled={!s.dataset || s.busy.keywords} onClick={actions.generateKeywords}>
          {s.keywords.length ? 'Regenerate keywords' : 'Generate keywords'}
        </button>{' '}
        {s.busy.keywords && <Spinner label="thinking of visual metaphors…" />}
        {s.keywords.length > 0 && (
          <>
            <WordCloud keywords={s.keywords} />
            <p className="muted small">Click a word to include/exclude it from image prompts.</p>
            <details><summary>Raw model response</summary><pre>{s.keywordResponse}</pre></details>
            <h3>3 · Candidate images</h3>
            <button className="primary" disabled={pendingImages || !s.keywords.some((k) => k.active)} onClick={actions.generateFromKeywords}>
              Generate images from top keywords
            </button>
            {s.imagePrompts.length > 0 && (
              <details><summary>Image prompts</summary><ol>{s.imagePrompts.map((p, i) => <li key={i}>{p}</li>)}</ol></details>
            )}
          </>
        )}
        <CandidateGallery />
        {s.candidateRounds.length > 0 && (
          <p><button onClick={() => actions.setTab(1)}>Refine with your own concept →</button></p>
        )}
      </section>
    </div>
  );
}

/** Processes 2 + 3: concept prompt loop, then pick the glyph image */
export function ConceptView() {
  const s = useStore();
  const pending = s.candidateRounds.some((r) => r.images.some((i) => 'pending' in i));
  return (
    <div className="cols">
      <section className="panel narrow">
        <h2>Concept</h2>
        {s.keywords.length > 0 && <WordCloud keywords={s.keywords} width={360} height={180} />}
        <label>Describe the glyph you want (refine and regenerate as often as needed)</label>
        <textarea rows={4} value={s.conceptPrompt} placeholder="e.g. a stylised fruit with a leaf and a stem, the body split into two halves"
          onChange={(e) => actions.setConceptPrompt(e.target.value)} />
        <button className="primary" disabled={pending || !s.conceptPrompt.trim()} onClick={() => actions.generateFromConcept()}>
          {s.candidateRounds.some((r) => r.source === 'concept') ? 'Regenerate with this concept' : 'Generate 4 images'}
        </button>
        {pending && <Spinner label=" generating…" />}
      </section>
      <section className="panel">
        <h2>Candidates — pick one as the glyph</h2>
        <CandidateGallery />
      </section>
    </div>
  );
}
