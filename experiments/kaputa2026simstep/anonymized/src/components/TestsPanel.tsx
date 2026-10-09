// Process 3 results (r13*, r14*, r15*, r16*, r17) and process 4 (review a test case and fix).
import { useState } from 'react';
import { op } from '../api';
import { useCurrentCode, useStore } from '../store';
import { VERDICTS, type FixOption, type FixProposal, type TestCase, type Verdict } from '../shared/types';
import { svgDataUrl } from '../tools/sandbox';
import { VisualView } from './VisualView';

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: '✓ Looks correct',
  'something-missing': 'Something is missing',
  'something-wrong': 'Something is wrong',
  unreadable: 'Hard to read',
};

function Process3Status() {
  const s = useStore();
  const has = (id: string) => s.codeVersions.some((v) => v.id === id);
  const steps: [string, boolean][] = [
    ['tool_2 execute → r13* errors', s.runErrors.length > 0 || has('r12_2')],
    ['model modify → r12_2', has('r12_2')],
    ['model generate → r14* tests', s.testCases.length > 0],
    ['tool_2 execute → r15* r16*', s.testResults.length > 0],
    ['model evaluate → r17', !!s.critique],
    ['model modify → r12_3', has('r12_3')],
  ];
  return (
    <ol className="pipeline">
      {steps.map(([l, ok]) => (
        <li key={l} className={ok ? 'ok' : ''}>
          {l}
        </li>
      ))}
    </ol>
  );
}

export function TestsPanel() {
  const s = useStore();
  const current = useCurrentCode();
  const [sel, setSel] = useState<TestCase | null>(null); // r19
  const [verdict, setVerdict] = useState<Verdict | null>(null); // r21
  const [category, setCategory] = useState<{ category: string; reason: string } | null>(null); // r22
  const [proposal, setProposal] = useState<FixProposal | null>(null); // r23
  const [chosen, setChosen] = useState<FixOption | null>(null); // r24

  const pick = (t: TestCase) => {
    setSel(t);
    setVerdict(null);
    setCategory(null);
    setProposal(null);
    setChosen(null);
  };

  // [human evaluate] r21 → [model select] r22 → [model generate]~ r23
  const evaluate = async (v: Verdict) => {
    if (!sel || !current) return;
    setVerdict(v);
    setCategory(null);
    setProposal(null);
    setChosen(null);
    const code = current.code;
    try {
      const c = await s.run('model select: issue category (r22)', () =>
        op<{ category: string; reason: string }>('issueCategory', { verdict: v, testCase: sel, code }),
      );
      setCategory(c);
      const p = await s.run('model generate: fix options (r23)', () =>
        op<FixProposal>('fixOptions', { category: c.category, verdict: v, testCase: sel, code }),
      );
      setProposal(p);
    } catch {
      /* error shown in status bar */
    }
  };

  // [human select] r24 → [model modify]~ r25_4
  const applyFix = async (f: FixOption) => {
    if (!current) return;
    setChosen(f);
    try {
      const code = await s.run('model modify: apply fix (r25_4)', () => op<string>('applyFix', { fix: f, code: current.code }));
      s.addCode('r25_4', `fix: ${f.title}`, code);
    } catch {
      setChosen(null);
    }
  };

  const busy = !!s.busy;
  return (
    <div className="tests-panel">
      <div className="p3">
        <h4>Automatic test &amp; revise (process 3)</h4>
        <Process3Status />
        {s.runErrors.length > 0 && (
          <div>
            <strong>r13* execution errors</strong>
            <ul className="errors">
              {s.runErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {s.codeVersions.some((v) => v.id === 'r12_2') && s.runErrors.length === 0 && <p className="muted">r13*: no execution errors.</p>}
        {s.critique && (
          <div className="critique">
            <strong>r17 model critique</strong>
            <pre className="prose">{s.critique}</pre>
          </div>
        )}
        <button className="small" disabled={busy || !s.codeVersions.length} onClick={() => s.runProcess3()}>
          Re-run test &amp; revise
        </button>
      </div>

      <div className="p4">
        <h4>Test cases r14* — results r15*, snapshots r16* (snapshots taken on r12_2)</h4>
        <div className="gallery">
          {s.testCases.map((t) => {
            const r = s.testResults.find((x) => x.testId === t.id);
            return (
              <button key={t.id} className={`thumb ${sel?.id === t.id ? 'chosen' : ''}`} onClick={() => pick(t)} title={t.description}>
                {r?.svg ? <img src={svgDataUrl(r.svg)} alt={t.name} /> : <div className="noimg">no output</div>}
                <div className="thumb-label">
                  <span className={`status ${r?.status}`}>{r?.status ?? '…'}</span> {t.name}
                </div>
                {r && (
                  <div className="muted tiny">
                    {r.stats.total ?? 0} elements{r.errors.length ? ` · ${r.errors[0]}` : ''}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {sel && current && (
          <div className="review">
            <div>
              <h4>
                r20 — {sel.name} rendered with {current.id}
              </h4>
              <VisualView code={current.code} data={sel.data} scale={0.75} />
            </div>
            <div className="review-side">
              <p>
                <strong>Expectation:</strong> {sel.expectation}
              </p>
              <details>
                <summary>test data</summary>
                <pre className="code small">{JSON.stringify(sel.data, null, 1)}</pre>
              </details>
              <p>
                <strong>r21 Your verdict:</strong>
              </p>
              <div className="row wrap">
                {VERDICTS.map((v) => (
                  <button key={v} disabled={busy} className={verdict === v ? 'primary' : ''} onClick={() => evaluate(v)}>
                    {VERDICT_LABEL[v]}
                  </button>
                ))}
              </div>
              {category && (
                <p>
                  <span className="tag">r22 {category.category}</span> <span className="muted">{category.reason}</span>
                </p>
              )}
              {proposal && (
                <>
                  <p>
                    <strong>r23 Diagnosis:</strong> {proposal.diagnosis}
                  </p>
                  <div className="cards">
                    {proposal.options.map((o, i) => (
                      <button key={i} disabled={busy} className={`card ${chosen === o ? 'chosen' : ''}`} onClick={() => applyFix(o)}>
                        <strong>{o.title}</strong>
                        <br />
                        {o.instruction}
                      </button>
                    ))}
                  </div>
                  {chosen && !busy && <p className="ok">Applied as a new code version (r25_4).</p>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
