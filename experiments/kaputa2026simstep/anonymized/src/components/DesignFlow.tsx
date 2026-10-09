// Process 1 (design pipeline) and process 2 (modify intent graph).
import { useState } from 'react';
import { latest, useStore } from '../store';
import { GraphEditor } from './GraphEditor';
import { GraphView } from './GraphView';

const EXAMPLES = [
  'Show how monthly rainfall compares across five cities over a year, so I can see which city is wettest in each season.',
  'A chart of my team\'s weekly task completion, highlighting weeks where we fell below target.',
  'Compare the population and GDP per capita of 12 countries and let me hover to see details.',
];

function Step({ id, title, done, children }: { id: string; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={`step ${done ? 'done' : ''}`}>
      <header>
        <span className="rid">{id}</span>
        <h3>{title}</h3>
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}

export function DesignFlow() {
  const s = useStore();
  const [editing, setEditing] = useState(false);
  const intent = latest(s.intentGraphs);
  const intentId = s.intentGraphs[s.intentGraphs.length - 1]?.id;
  const busy = !!s.busy;
  const component = latest(s.componentGraphs);

  return (
    <div className="design-flow">
      <Step id="r1" title="Describe the visualization you want" done={s.intentGraphs.length > 0}>
        <textarea
          rows={3}
          value={s.request}
          placeholder="e.g. Show how monthly rainfall compares across cities…"
          onChange={(e) => s.setRequest(e.target.value)}
        />
        <div className="row">
          <button className="primary" disabled={busy || !s.request.trim()} onClick={() => s.startDesign().catch(() => {})}>
            {s.intentGraphs.length ? 'Start over from this request' : 'Translate to intent graph'}
          </button>
          {!s.request && (
            <span className="examples">
              Examples:{' '}
              {EXAMPLES.map((e, i) => (
                <button key={i} className="link" onClick={() => s.setRequest(e)}>
                  #{i + 1}
                </button>
              ))}
            </span>
          )}
        </div>
      </Step>

      {intent && (
        <Step id={intentId!} title="Intent graph" done={s.concepts.length > 0}>
          {editing ? (
            <GraphEditor
              graph={intent}
              onSave={(g) => {
                s.modifyIntentGraph(g);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <GraphView graph={intent} maxHeight={320} />
              <div className="row">
                <button disabled={busy} onClick={() => setEditing(true)}>
                  Edit graph
                </button>
                <span className="muted">
                  versions: {s.intentGraphs.map((v) => v.id).join(', ')}
                </span>
                <span className="spacer" />
                <button className="primary" disabled={busy} onClick={() => s.generateConcepts().catch(() => {})}>
                  {s.concepts.length ? 'Regenerate concepts' : 'Generate design concepts →'}
                </button>
              </div>
            </>
          )}
        </Step>
      )}

      {s.concepts.length > 0 && (
        <Step id="r3*" title="Design concepts — pick one" done={!!s.designGraph}>
          <div className="cards">
            {s.concepts.map((c, i) => (
              <button
                key={i}
                className={`card ${s.concept === c ? 'chosen' : ''}`}
                disabled={busy}
                onClick={() => s.selectConcept(c).catch(() => {})}
              >
                {c}
              </button>
            ))}
          </div>
        </Step>
      )}

      {s.designGraph && (
        <Step id="r5" title="Design graph" done={s.buildOptions.length > 0}>
          <p className="muted">Chosen concept (r4): {s.concept}</p>
          <GraphView graph={s.designGraph} highlight={s.scopeGraph?.nodes.map((n) => n.id) ?? []} maxHeight={360} />
        </Step>
      )}

      {s.buildOptions.length > 0 && (
        <Step id="r6*" title="What should the first version do? — pick one" done={!!s.buildInstruction}>
          <div className="cards">
            {s.buildOptions.map((b, i) => (
              <button
                key={i}
                className={`card ${s.buildInstruction === b ? 'chosen' : ''}`}
                disabled={busy}
                onClick={() => s.selectBuildInstruction(b).catch(() => {})}
              >
                {b}
              </button>
            ))}
          </div>
          <button className="link" disabled={busy} onClick={() => s.regenerateBuildOptions().catch(() => {})}>
            regenerate options
          </button>
        </Step>
      )}

      {s.scopeGraph && (
        <Step id="r8" title="Scope selected from the design graph" done={!!s.dataSpec}>
          <p className="muted">Build instruction (r7): {s.buildInstruction}</p>
          <p>
            {s.scopeGraph.nodes.length} of {s.designGraph?.nodes.length} design nodes in scope (highlighted above):{' '}
            {s.scopeGraph.nodes.map((n) => n.label).join(', ')}
          </p>
        </Step>
      )}

      {s.dataSpec && (
        <Step id="r9" title="Data specification" done={!!s.plan}>
          <table className="data-table">
            <thead>
              <tr>
                {s.dataSpec.fields.map((f) => (
                  <th key={f.name} title={f.description}>
                    {f.name}
                    <small> {f.type}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.dataSpec.sample.slice(0, 8).map((row, i) => (
                <tr key={i}>
                  {s.dataSpec!.fields.map((f) => (
                    <td key={f.name}>{String(row[f.name] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Step>
      )}

      {s.plan && (
        <Step id="r10" title="Implementation plan" done={!!component}>
          <pre className="prose">{s.plan}</pre>
        </Step>
      )}

      {component && (
        <Step id="r11" title="Component graph" done={s.codeVersions.length > 0}>
          <GraphView graph={component} maxHeight={320} />
          {s.codeVersions.length > 0 && <p className="muted">Code r12_1 generated — continue in the Workspace tab.</p>}
        </Step>
      )}
    </div>
  );
}
