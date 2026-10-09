import { useAppState, type AppState } from "./store.ts";
import DataStep from "./steps/DataStep.tsx";
import IllustrateStep from "./steps/IllustrateStep.tsx";
import SegmentStep from "./steps/SegmentStep.tsx";
import VariantsStep from "./steps/VariantsStep.tsx";
import ChartStep from "./steps/ChartStep.tsx";
import AnnotateStep from "./steps/AnnotateStep.tsx";
import ExportStep from "./steps/ExportStep.tsx";

const STEPS: { title: string; processes: string; ready: (s: AppState) => boolean }[] = [
  { title: "Data", processes: "P1 start", ready: () => true },
  { title: "Illustrate", processes: "P1 · P2 · P3", ready: (s) => !!s.r3 },
  { title: "Segment & bind", processes: "P4", ready: (s) => !!s.r11 },
  { title: "Element variants", processes: "P5", ready: (s) => s.r14.some((l) => l.role === "mark" && l.field) },
  { title: "Chart", processes: "P6", ready: (s) => s.r19.some((v) => v.svg) },
  { title: "Annotate", processes: "P7", ready: (s) => s.r19.some((v) => v.svg) && !!s.r21 },
  { title: "Export", processes: "P8", ready: (s) => !!s.r21 && s.r19.some((v) => v.svg) },
];

export default function App() {
  const [state, update, reset] = useAppState();
  const go = (step: number) => update((s) => ({ ...s, step }));
  const props = { state, update, go };
  const Step = [DataStep, IllustrateStep, SegmentStep, VariantsStep, ChartStep, AnnotateStep, ExportStep][state.step];
  return (
    <div className="app">
      <aside>
        <h1>Pictograph Studio</h1>
        <p className="sub">from a table to an illustrated chart</p>
        <ol className="stepper">
          {STEPS.map((st, i) => (
            <li key={st.title}>
              <button className={i === state.step ? "active" : ""} disabled={!st.ready(state)} onClick={() => go(i)}>
                <span className="n">{i + 1}</span>
                <span>
                  {st.title}
                  <small>{st.processes}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <button
          className="ghost small"
          onClick={() => {
            if (confirm("Discard the whole session and start over?")) reset();
          }}
        >
          Start over
        </button>
      </aside>
      <main>
        <Step {...props} />
      </main>
    </div>
  );
}

export interface StepProps {
  state: AppState;
  update: ReturnType<typeof useAppState>[1];
  go: (step: number) => void;
}
