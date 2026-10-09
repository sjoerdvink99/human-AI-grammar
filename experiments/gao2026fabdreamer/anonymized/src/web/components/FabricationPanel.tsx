// P10: r27 + r38 → [tool_3 evaluate] r39* → [model_4 generate]~ r40 → [human select] r41
//      → [model_4 translate] r42 → [tool_3 execute] r27 → loop (checks run again).
import { useApp, currentAssembly } from "../store";
import { p10Apply, p10Check } from "../pipelines";
import { AssemblyView } from "./AssemblyView";
import { Empty, Status, Step } from "./common";
import type { Constraints } from "../../shared/types";

const METHODS: Constraints["method"][] = ["laser-cut sheet", "cnc sheet", "3d print", "woodworking"];

export function FabricationPanel() {
  const s = useApp();
  const asm = currentAssembly(s);
  const c = s.constraints;
  const setC = (p: Partial<Constraints>) => s.set({ constraints: { ...c, ...p } });
  if (!asm) return <div className="panel"><Empty>Compose an assembly first (step 3 → “Assemble these parts”).</Empty></div>;
  const round = s.fabRounds.at(-1);
  const highlight = round?.checks.filter((x) => x.severity !== "info").flatMap((x) => x.partIds) ?? [];
  const busy = !!s.busy.p10;
  const num = (k: keyof Constraints) => (
    <label>{k}<input type="number" value={c[k] as number} onChange={(e) => setC({ [k]: Number(e.target.value) || 0 } as Partial<Constraints>)} /></label>
  );

  return (
    <div className="panel assembly">
      <div className="main-view">
        <AssemblyView parts={asm.parts} highlightIds={highlight} height={520} />
        <p className="hint">Parts involved in failing checks glow red. r27_{s.assemblyIndex + 1}</p>
      </div>
      <aside className="inspector">
        <Step id="r38" actor="human" title="Fabrication constraints">
          <div className="form-grid">
            <label>method
              <select value={c.method} onChange={(e) => setC({ method: e.target.value as Constraints["method"] })}>
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label>material<input value={c.material} onChange={(e) => setC({ material: e.target.value })} /></label>
            {num("sheetThickness")}{num("minThickness")}{num("maxW")}{num("maxH")}{num("maxD")}
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => p10Check()}>Check design</button>
            <Status k="p10" />
          </div>
        </Step>
        {round && (
          <Step id="r39*" actor="tool_3" title="Checks">
            <ul className="checks">
              {round.checks.map((x) => <li key={x.id} className={x.severity}><b>{x.severity}</b> {x.message}</li>)}
            </ul>
          </Step>
        )}
        {round?.advice && (
          <Step id="r40 → r41" actor="model_4" title="Advisor">
            <p className="prose">{round.advice.summary}</p>
            {round.advice.suggestions.length === 0 ? <Empty>No changes suggested.</Empty> : (
              <ul className="suggestions">
                {round.advice.suggestions.map((g) => (
                  <li key={g.id}>
                    <div><b>{g.title}</b><p className="small">{g.rationale}</p></div>
                    <button disabled={busy} onClick={() => p10Apply(g)}>Apply</button>
                  </li>
                ))}
              </ul>
            )}
          </Step>
        )}
        {s.fabRounds.filter((r) => r.chosen).length > 0 && (
          <Step id="r41 → r42 → r27" actor="model_4 / tool_3" title="Applied fixes">
            <ol className="small">
              {s.fabRounds.filter((r) => r.chosen).map((r, i) => (
                <li key={i}><b>{r.chosen!.title}</b> — {r.ops.length} op(s): {r.ops.map((o) => `${o.op}${o.partId ? ` ${o.partId}` : o.name ? ` ${o.name}` : ""}`).join(", ")}
                  {r.skipped.length > 0 && <span className="warn"> (skipped: {r.skipped.join("; ")})</span>}</li>
              ))}
            </ol>
            <small>Undo any fix in the Assembly tab.</small>
          </Step>
        )}
      </aside>
    </div>
  );
}
