import { useApp, resetAll, currentConcept, currentSpec, currentAssembly, type Tab } from "./store";
import { ConceptPanel } from "./components/ConceptPanel";
import { SpecPanel } from "./components/SpecPanel";
import { PartsPanel } from "./components/PartsPanel";
import { RefinePanel } from "./components/RefinePanel";
import { StudioPanel } from "./components/StudioPanel";
import { AssemblyPanel } from "./components/AssemblyPanel";
import { FabricationPanel } from "./components/FabricationPanel";
import { ExportPanel } from "./components/ExportPanel";

const TABS: { id: Tab; n: string; label: string; procs: string }[] = [
  { id: "concept", n: "1", label: "Concept", procs: "P1 · P2" },
  { id: "spec", n: "2", label: "Specification", procs: "P3" },
  { id: "parts", n: "3", label: "Parts", procs: "P4" },
  { id: "refine", n: "4", label: "Refine parts", procs: "P5" },
  { id: "assembly", n: "5", label: "Assembly", procs: "P7 · P8 · P9" },
  { id: "fabrication", n: "6", label: "Fabrication", procs: "P10" },
  { id: "export", n: "7", label: "Export", procs: "P11" },
  { id: "studio", n: "+", label: "Part studio", procs: "P6" },
];

export function App() {
  const s = useApp();
  const done: Record<Tab, boolean> = {
    concept: !!currentConcept(s), spec: !!currentSpec(s), parts: s.parts3d.length > 0, refine: s.refinedParts.length > 0,
    assembly: !!currentAssembly(s), fabrication: s.fabRounds.length > 0, export: false, studio: !!s.studio.part,
  };
  const anyBusy = Object.values(s.busy)[0];
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">System X <small>concept → parts → assembly → fabrication</small></div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${s.tab === t.id ? "active" : ""} ${done[t.id] ? "done" : ""}`} onClick={() => s.set({ tab: t.id })} title={t.procs}>
              <span className="n">{done[t.id] ? "✓" : t.n}</span>{t.label}
            </button>
          ))}
        </nav>
        <div className="right">
          {anyBusy && <span className="status busy"><span className="spinner" /> working</span>}
          <button className="small" onClick={() => { if (confirm("Start a new design? This clears the current one.")) resetAll(); }}>New design</button>
        </div>
      </header>
      <main>
        {s.tab === "concept" && <ConceptPanel />}
        {s.tab === "spec" && <SpecPanel />}
        {s.tab === "parts" && <PartsPanel />}
        {s.tab === "refine" && <RefinePanel />}
        {s.tab === "studio" && <StudioPanel />}
        {s.tab === "assembly" && <AssemblyPanel />}
        {s.tab === "fabrication" && <FabricationPanel />}
        {s.tab === "export" && <ExportPanel />}
      </main>
    </div>
  );
}
