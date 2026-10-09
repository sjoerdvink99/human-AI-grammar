// Process 1 — Recommend figurative concepts
import { useState } from 'react';
import { api } from '../api';
import { Section, Spinner, Step, StatusLine, SvgView } from '../components';
import { initialState, uid, useStore, type ConceptImages } from '../store';
import { composeImagePrompts, describeDataset, extractAttributes, extractKeywords, parseCsv } from '../tools/tool1';
import { layoutWordCloud } from '../tools/wordcloud';
import { WordCloud } from './WordCloud';

export function ConceptsPanel() {
  const { s, set, get } = useStore();
  const [loadError, setLoadError] = useState<string>();

  async function onDataset(text: string, name: string) {
    setLoadError(undefined);
    let dataset;
    try {
      dataset = parseCsv(text, name); // (dataset_1: artifact tabular)
    } catch (e) {
      setLoadError((e as Error).message);
      return;
    }
    const attributes = extractAttributes(dataset); // [tool_1 extract]
    const datasetDescription = describeDataset(dataset, attributes); // [tool_1 translate]
    set({ ...initialState, dataset, attributes, datasetDescription, keywordStatus: 'loading' });
    await runKeywords(datasetDescription);
  }

  async function runKeywords(datasetDescription: string) {
    set({ keywordStatus: 'loading', keywordError: undefined, keywords: [], wordCloud: [], candidates1: [] });
    try {
      const { keywordResponse } = await api.keywords(datasetDescription); // [model_1 generate]~
      const keywords = extractKeywords(keywordResponse); // [tool_1 extract]
      if (keywords.length === 0) throw new Error('No usable keywords in the model response');
      const wordCloud = layoutWordCloud(keywords); // [tool_1 translate]
      const prompts = composeImagePrompts(keywords); // [tool_1 compose]
      const candidates1: ConceptImages[] = prompts.map((p) => ({ ...p, status: 'loading', images: [] }));
      set({ keywordStatus: 'done', keywordResponse, keywords, wordCloud, candidates1 });
      await Promise.all(prompts.map((p) => runImages(p.concept, p.prompt)));
    } catch (e) {
      set({ keywordStatus: 'error', keywordError: (e as Error).message });
    }
  }

  async function runImages(concept: string, prompt: string) {
    const patch = (u: Partial<ConceptImages>) =>
      set((st) => ({ candidates1: st.candidates1.map((c) => (c.concept === concept ? { ...c, ...u } : c)) }));
    patch({ status: 'loading', error: undefined });
    try {
      const { images } = await api.images(prompt); // [model_2 generate]~
      if (!get().candidates1.some((c) => c.concept === concept)) return;
      patch({ status: 'done', images: images.map((im) => ({ id: uid('img'), concept, prompt, title: im.title, svg: im.svg })) });
    } catch (e) {
      patch({ status: 'error', error: (e as Error).message });
    }
  }

  function refine(concept: string) {
    set({ conceptPrompt: concept, step: 2 });
  }

  return (
    <div className="panel">
      <Section title="Dataset" hint="Upload a CSV. Each row becomes one glyph; columns are typed as categorical or numerical.">
        <div className="row">
          <label className="button primary">
            Upload CSV…
            <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await onDataset(await f.text(), f.name.replace(/\.csv$/i, ''));
              e.target.value = '';
            }} />
          </label>
          <button onClick={async () => onDataset(await (await fetch('/samples/garden_plants.csv')).text(), 'garden plants')}>
            Use sample: garden plants
          </button>
          {loadError && <span className="error">⚠ {loadError}</span>}
        </div>
        {s.dataset && (
          <div className="two-col">
            <div>
              <h4>Attributes <Step>tool_1 extract</Step></h4>
              <table className="attrs">
                <thead><tr><th>Column</th><th>Type</th><th>Values</th></tr></thead>
                <tbody>
                  {s.attributes.map((a) => (
                    <tr key={a.name} className={a.usable ? '' : 'muted'}>
                      <td>{a.name}</td>
                      <td><span className={`kind ${a.kind}`}>{a.kind}</span></td>
                      <td>{a.kind === 'numerical' ? `${a.min} – ${a.max}` : a.usable ? a.values.join(', ') : `${a.values.length} distinct (not encodable)`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">{s.dataset.rows.length} rows · {s.dataset.name}</p>
            </div>
            <div>
              <h4>Description for the language model <Step>tool_1 translate</Step></h4>
              <pre className="desc">{s.datasetDescription}</pre>
            </div>
          </div>
        )}
      </Section>

      {s.dataset && (
        <Section
          title="Suggested concepts"
          hint="Keywords suggested by the language model. Click a word to refine it into a glyph concept."
          actions={<button disabled={s.keywordStatus === 'loading'} onClick={() => runKeywords(s.datasetDescription)}>↻ Suggest again</button>}
        >
          <StatusLine status={s.keywordStatus} error={s.keywordError} loading="model_1 is suggesting keywords…" />
          {s.wordCloud.length > 0 && (
            <div className="row top">
              <WordCloud items={s.wordCloud} onPick={refine} />
              <ul className="kwlist">
                {s.keywords.map((k) => (
                  <li key={k.word}><b>{k.word}</b> <span className="muted">({k.weight})</span>{k.reason && <> — {k.reason}</>}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {s.candidates1.length > 0 && (
        <Section title="Candidate images" hint="Three generated candidates per concept (model_2). Pick a concept to refine and choose a prototype.">
          <div className="concepts">
            {s.candidates1.map((c) => (
              <div className="concept" key={c.concept}>
                <div className="concept-head">
                  <b>{c.concept}</b>
                  <span>
                    <button className="small" disabled={c.status === 'loading'} onClick={() => runImages(c.concept, c.prompt)} title="Regenerate">↻</button>
                    <button className="small primary" onClick={() => refine(c.concept)}>Refine →</button>
                  </span>
                </div>
                <div className="thumbs">
                  {c.status === 'loading' && <Spinner label="model_2 drawing…" />}
                  {c.status === 'error' && <span className="error">⚠ {c.error}</span>}
                  {c.images.map((im) => <SvgView key={im.id} svg={im.svg} className="thumb" title={im.title} />)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
