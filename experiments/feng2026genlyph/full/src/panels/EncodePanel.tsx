// Process 5 — Generate and refine categorical encodings
import { Section, Spinner, Step, StatusLine, SvgView } from '../components';
import { generateEncodings, runCategoricalPipeline } from '../pipelines';
import { useStore } from '../store';
import { categoricalFragmentSvg } from '../tools/tool3';

export function EncodePanel({ onNext }: { onNext: () => void }) {
  const { s, set, get } = useStore();
  const gi = s.glyphImage!;
  const busy = s.describeStatus === 'loading' || Object.values(s.encodeStatus).some((v) => v === 'loading');

  const setPrompt = (maskId: string, value: string, prompt: string) =>
    set((st) => ({ encodingPrompts: st.encodingPrompts.map((p) => (p.maskId === maskId && p.value === value ? { ...p, prompt } : p)) }));

  return (
    <div className="panel">
      <Section
        title="Categorical encodings"
        hint={<>Parts are cut out with their edge maps <Step>tool_2 extract</Step>, described <Step>model_4 generate</Step>, and recoloured / retextured on fixed edges for each category value <Step>model_5 generate</Step>. Edit any prompt and regenerate until the variants match your intent <Step>human modify</Step>.</>}
        actions={<>
          <button disabled={busy} onClick={() => runCategoricalPipeline(get, set)}>↻ Restart from fragments</button>
          <button className="primary" disabled={busy || s.fragments.length === 0 || s.describeStatus !== 'done'} onClick={onNext}>Continue → assembly</button>
        </>}
      >
        <StatusLine status={s.describeStatus} error={s.describeError} loading="model_4 is describing the parts…" />
        {s.fragments.map((f) => {
          const mp = s.mappings.find((m) => m.maskId === f.maskId);
          const edges = s.fragmentEdges.find((e) => e.maskId === f.maskId);
          const prompts = s.encodingPrompts.filter((p) => p.maskId === f.maskId);
          return (
            <div className="fragment" key={f.maskId}>
              <div className="fragment-head">
                <SvgView svg={f.svg} className="thumb" title="fragment" />
                {edges && <SvgView svg={edges.svg} className="thumb" title="edge map" />}
                <div>
                  <h4>{f.name}</h4>
                  <p className="muted">
                    {mp?.categorical ? <>categorical: <b>{mp.categorical}</b></> : 'no categorical attribute'}
                    {mp?.numerical && <> · numerical: <b>{mp.numerical}</b></>}
                  </p>
                  <p>{s.descriptions[f.maskId] ?? (s.describeStatus === 'loading' ? <Spinner label="describing…" /> : '—')}</p>
                </div>
                {prompts.length > 0 && (
                  <button disabled={busy} onClick={() => generateEncodings(get, set, get().encodingPrompts.filter((p) => p.maskId === f.maskId))}>
                    ↻ Regenerate all values
                  </button>
                )}
              </div>
              {!mp?.categorical && <p className="hint">This part keeps its original colours.</p>}
              <div className="variants">
                {prompts.map((p) => {
                  const key = `${p.maskId}|${p.value}`;
                  const cf = s.categoricalFragments.find((c) => c.maskId === p.maskId && c.value === p.value);
                  return (
                    <div className="variant" key={key}>
                      <div className="variant-img">
                        {s.encodeStatus[key] === 'loading' ? <Spinner label="" /> : cf ? <SvgView svg={categoricalFragmentSvg(f, cf, gi.defs)} className="thumb" /> : <div className="thumb empty" />}
                      </div>
                      <div className="variant-body">
                        <b>{p.value}</b>
                        <textarea rows={3} value={p.prompt} onChange={(e) => setPrompt(p.maskId, p.value, e.target.value)} />
                        <div className="row">
                          <button className="small" disabled={s.encodeStatus[key] === 'loading'} onClick={() => generateEncodings(get, set, [get().encodingPrompts.find((x) => x.maskId === p.maskId && x.value === p.value)!])}>↻ Regenerate</button>
                          {s.encodeErrors[key] && <span className="error">⚠ {s.encodeErrors[key]}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}
