import { useState } from 'react';
import type { CodeCandidate, Concept, DerivationRequest, Table, Value } from '../../shared/types';
import { api } from '../api';
import { Code } from './Code';
import { DataTable } from './DataTable';

/**
 * Process 3 (derive) and process 4 (refine).
 * human specify/modify derivation_request -> tool_1 compose llm_prompts* -> model generate~ code_candidates*
 * -> tool_1 evaluate valid_codes* + preview_tables* -> human select selected_code -> tool_1 execute.
 */
export function DerivePanel({
  table,
  concepts,
  refine,
  onApply,
  onClose,
}: {
  table: Table;
  concepts: Concept[];
  refine?: Concept;
  onApply: (request: DerivationRequest, code: string, values: Value[]) => void;
  onClose: () => void;
}) {
  const previous = refine?.derivation?.requests.at(-1);
  const [request, setRequest] = useState<DerivationRequest>(previous ? { ...previous } : { sources: [], name: '', description: '' });
  const [prompts, setPrompts] = useState<string[] | null>(null);
  const [candidates, setCandidates] = useState<CodeCandidate[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'composing' | 'generating' | 'applying'>('idle');
  const [error, setError] = useState<string | null>(null);

  const sourceOptions = concepts.filter((c) => c.source !== 'custom' && c.name !== refine?.name);
  const types = Object.fromEntries(concepts.map((c) => [c.name, c.type]));
  const nameClash = !refine && table.columns.some((c) => c.toLowerCase() === request.name.trim().toLowerCase());
  const unchanged = !!previous && previous.description.trim() === request.description.trim() && previous.sources.join() === request.sources.join();
  const ready = request.sources.length > 0 && request.name.trim() !== '' && request.description.trim() !== '' && !nameClash;

  const toggleSource = (name: string) =>
    setRequest((r) => ({ ...r, sources: r.sources.includes(name) ? r.sources.filter((s) => s !== name) : [...r.sources, name] }));

  const generate = async (reusePrompts = false) => {
    setError(null);
    setSelected(null);
    setCandidates(null);
    const req = { ...request, name: request.name.trim(), description: request.description.trim() };
    try {
      let p = prompts;
      if (!reusePrompts || !p) {
        setPhase('composing');
        p = (await api.post<{ prompts: string[] }>('/api/derive/prompts', { request: req, rows: table.rows, types })).prompts;
        setPrompts(p);
      }
      setPhase('generating');
      const res = await api.post<{ candidates: CodeCandidate[] }>('/api/derive/generate', { request: req, rows: table.rows, prompts: p });
      setCandidates(res.candidates);
      const firstValid = res.candidates.findIndex((c) => c.valid);
      setSelected(firstValid >= 0 ? firstValid : null);
      if (firstValid < 0) setError('None of the generated functions ran on the table. Rephrase the description and try again.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const apply = async () => {
    if (selected === null || !candidates) return;
    const c = candidates[selected];
    setPhase('applying');
    setError(null);
    try {
      const req = { ...request, name: request.name.trim(), description: request.description.trim() };
      const { values } = await api.post<{ values: Value[] }>('/api/apply', { code: c.code, rows: table.rows, sources: req.sources });
      onApply(req, c.code, values);
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  };

  const busy = phase !== 'idle';
  const valid = candidates?.filter((c) => c.valid) ?? [];
  const invalid = candidates?.filter((c) => !c.valid) ?? [];

  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{refine ? `Refine “${refine.name}”` : 'Derive a new concept'}</h2>
          <button className="link" onClick={onClose} disabled={busy}>
            close
          </button>
        </div>

        <div className="form">
          <div>
            <div className="label">Source concepts</div>
            <div className="chips">
              {sourceOptions.map((c) => (
                <button key={c.name} className={`chip ${request.sources.includes(c.name) ? 'on' : ''}`} onClick={() => toggleSource(c.name)} disabled={busy}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <label>
            New concept name
            <input value={request.name} disabled={!!refine || busy} onChange={(e) => setRequest({ ...request, name: e.target.value })} placeholder="e.g. Temperature difference" />
          </label>
          {nameClash && <div className="error small">The table already has a column with this name.</div>}
          <label>
            How to compute it
            <textarea
              rows={3}
              value={request.description}
              disabled={busy}
              onChange={(e) => setRequest({ ...request, description: e.target.value })}
              placeholder="e.g. Seattle temperature minus Atlanta temperature"
            />
          </label>
          {refine && previous && (
            <div className="muted small">
              Previous description{refine.derivation!.requests.length > 1 ? ` (version ${refine.derivation!.requests.length})` : ''}: “{previous.description}”
            </div>
          )}
          <div className="row">
            <button onClick={() => generate(false)} disabled={!ready || busy || (!!refine && unchanged && !candidates)}>
              {phase === 'composing' ? 'Composing prompts…' : phase === 'generating' ? 'Generating functions…' : 'Generate'}
            </button>
            {candidates && prompts && (
              <button className="secondary" onClick={() => generate(true)} disabled={busy}>
                Regenerate with the same prompts
              </button>
            )}
            {refine && unchanged && !candidates && <span className="muted small">Edit the description to refine.</span>}
          </div>
        </div>

        {busy && phase !== 'applying' && <div className="loading">The model is writing candidate functions; this can take up to a minute…</div>}
        {error && <div className="error">{error}</div>}

        {prompts && (
          <details>
            <summary>Prompts sent to the model ({prompts.length})</summary>
            {prompts.map((p, i) => (
              <div key={i}>
                <div className="muted small">Prompt {i + 1}</div>
                <Code code={p.replace(/^```typescript\n|```$/g, '')} maxHeight={260} />
              </div>
            ))}
          </details>
        )}

        {valid.length > 0 && (
          <>
            <h3>Candidates that run on the table — inspect and pick one</h3>
            <div className="candidates">
              {candidates!.map((c, i) =>
                c.valid ? (
                  <label key={i} className={`candidate code-candidate ${selected === i ? 'selected' : ''}`}>
                    <div className="candidate-head">
                      <input type="radio" checked={selected === i} onChange={() => setSelected(i)} />
                      <strong>Function {valid.indexOf(c) + 1}</strong>
                      <span className="muted small">from prompt {c.prompt + 1}</span>
                    </div>
                    <DataTable
                      columns={[...request.sources, request.name.trim(), ...(refine ? [`${refine.name} (current)`] : [])]}
                      rows={c.preview!.map((r, k) => (refine ? { ...r, [`${refine.name} (current)`]: table.rows[k]?.[refine.name] ?? null } : r))}
                      highlight={[request.name.trim()]}
                      compact
                    />
                    <details>
                      <summary>Code</summary>
                      <Code code={c.code} maxHeight={300} />
                    </details>
                  </label>
                ) : null,
              )}
            </div>
            <div className="row">
              <button onClick={apply} disabled={selected === null || busy}>
                {phase === 'applying' ? 'Applying…' : refine ? 'Apply corrected function' : 'Apply to table'}
              </button>
            </div>
          </>
        )}
        {invalid.length > 0 && (
          <details>
            <summary>{invalid.length} candidate(s) failed and were discarded</summary>
            {invalid.map((c, i) => (
              <div key={i}>
                <div className="error small">Prompt {c.prompt + 1}: {c.error}</div>
                {c.code && <Code code={c.code} maxHeight={200} />}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
