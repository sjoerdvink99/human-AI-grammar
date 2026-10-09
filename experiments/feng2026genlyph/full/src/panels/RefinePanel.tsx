// Process 2 — Refine figurative image candidates; Process 3 — Select figurative prototype
import { useState } from 'react';
import { api } from '../api';
import { Section, Spinner, Step, SvgView } from '../components';
import { uid, useStore, type RefineRound } from '../store';
import { normalizeGlyphImage } from '../tools/svg';
import { composeImagePrompt } from '../tools/tool1';
import type { CandidateImage } from '../types';
import { WordCloud } from './WordCloud';

export function RefinePanel() {
  const { s, set } = useStore();
  const [selectError, setSelectError] = useState<string>();

  async function generate(conceptPrompt: string) {
    const text = conceptPrompt.trim();
    if (!text) return;
    const imagePrompt = composeImagePrompt(text); // [tool_1 compose] concept_prompt_1 -> image_prompt_2
    const round: RefineRound = { id: uid('round'), conceptPrompt: text, imagePrompt, status: 'loading', images: [] };
    set((st) => ({ rounds: [round, ...st.rounds] }));
    const patch = (u: Partial<RefineRound>) => set((st) => ({ rounds: st.rounds.map((r) => (r.id === round.id ? { ...r, ...u } : r)) }));
    try {
      const { images } = await api.images(imagePrompt); // [model_2 generate]~ -> candidate_images_2*
      patch({ status: 'done', images: images.map((im) => ({ id: uid('img'), concept: text, prompt: imagePrompt, title: im.title, svg: im.svg })) });
    } catch (e) {
      patch({ status: 'error', error: (e as Error).message });
    }
  }

  // Process 3: [human select] candidate_images_2* -> glyph_image_1
  function select(im: CandidateImage) {
    setSelectError(undefined);
    try {
      const glyphImage = normalizeGlyphImage(im);
      set({
        glyphImage, regions: [], masks: [], mappings: [], fragments: [], fragmentEdges: [], descriptions: {},
        encodingPrompts: [], categoricalFragments: [], encodeStatus: {}, encodeErrors: {}, contours: [], assembly: null,
        recommendation: null, layout: null, step: 3,
      });
    } catch (e) {
      setSelectError(`This image cannot be used: ${(e as Error).message}`);
    }
  }

  const loading = s.rounds.some((r) => r.status === 'loading');

  return (
    <div className="panel">
      <div className="two-col narrow-left">
        <Section title="Concepts" hint="Click a keyword, or look at the first candidates for inspiration.">
          <WordCloud items={s.wordCloud} width={420} height={220} active={s.conceptPrompt} onPick={(w) => set({ conceptPrompt: w })} />
          <div className="mini-gallery">
            {s.candidates1.flatMap((c) => c.images.slice(0, 3).map((im) => (
              <SvgView key={im.id} svg={im.svg} className="mini" title={`${c.concept}: ${im.title}`} />
            )))}
          </div>
        </Section>
        <Section title="Concept description" hint={<>Choose a keyword or describe your own figurative concept. <Step>human specify / modify</Step></>}>
          <textarea
            rows={3}
            value={s.conceptPrompt}
            placeholder="e.g. a flower with a round centre, petals and two leaves"
            onChange={(e) => set({ conceptPrompt: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(s.conceptPrompt); }}
          />
          <div className="row">
            <button className="primary" disabled={!s.conceptPrompt.trim() || loading} onClick={() => generate(s.conceptPrompt)}>
              Generate candidates
            </button>
            {s.rounds[0] && (
              <button disabled={loading} onClick={() => generate(s.rounds[0].conceptPrompt)}>↻ Refresh “{s.rounds[0].conceptPrompt.slice(0, 30)}”</button>
            )}
          </div>
          {s.rounds[0] && <p className="hint">Prompt sent to model_2: <i>{s.rounds[0].imagePrompt}</i></p>}
        </Section>
      </div>

      <Section title="Candidates" hint="Every round is kept. Choose one image as the glyph prototype. (Process 3 · human select)">
        {selectError && <p className="error">⚠ {selectError}</p>}
        {s.rounds.length === 0 && <p className="muted">No candidates yet — generate from a concept above.</p>}
        {s.rounds.map((r, i) => (
          <div className="round" key={r.id}>
            <div className="round-head">
              <span className="muted">Round {s.rounds.length - i}</span> <b>{r.conceptPrompt}</b>
              <button className="small" onClick={() => set({ conceptPrompt: r.conceptPrompt })}>Edit this description</button>
            </div>
            <div className="thumbs">
              {r.status === 'loading' && <Spinner label="model_2 drawing three candidates…" />}
              {r.status === 'error' && <span className="error">⚠ {r.error}</span>}
              {r.images.map((im) => (
                <div className={`pick ${s.glyphImage?.sourceId === im.id ? 'chosen' : ''}`} key={im.id}>
                  <SvgView svg={im.svg} className="thumb large" title={im.title} />
                  <div className="pick-foot">
                    <span className="muted">{im.title}</span>
                    <button className="small primary" onClick={() => select(im)}>Use as prototype</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
