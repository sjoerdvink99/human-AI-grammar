import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectProvider, useProject } from "./state";
import { Authoring } from "./views/Authoring";
import { Workspace } from "./views/Workspace";
import "./styles.css";

function App() {
  const { project, reset } = useProject();
  const [mode, setMode] = useState<"author" | "workspace">(project.verified ? "workspace" : "author");
  return (
    <>
      <header className="top">
        <h1>System X</h1>
        <span className="subtitle">from learning content to an interactive simulation</span>
        <nav>
          <button className={mode === "author" ? "on" : ""} onClick={() => setMode("author")}>
            Author
          </button>
          <button className={mode === "workspace" ? "on" : ""} disabled={!project.simulation_code.length} onClick={() => setMode("workspace")}>
            Simulation workspace
          </button>
          <button
            onClick={() => {
              if (confirm("Start a new project? The current one will be discarded.")) {
                reset();
                setMode("author");
              }
            }}
          >
            New project
          </button>
        </nav>
      </header>
      {mode === "author" ? <Authoring onOpenWorkspace={() => setMode("workspace")} /> : <Workspace />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProjectProvider>
      <App />
    </ProjectProvider>
  </StrictMode>,
);
