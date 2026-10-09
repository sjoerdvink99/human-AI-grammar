import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { AskPanel } from "./components/AskPanel";
import { DraftEditor } from "./components/DraftEditor";
import { SourcesPanel } from "./components/SourcesPanel";
import { SuggestionsPanel } from "./components/SuggestionsPanel";
import { WritingMapPanel } from "./components/WritingMapPanel";
import { sampleDocuments, sampleDraft } from "./sample";
import { addPinsToMap, composeDraftContext, emptyMap, linkMap, matchMapToGraph, matchNodeSpans, selectGroundedSpans } from "./shared/tools";
import type {
  AnswerFact,
  AskResponse,
  DraftContext,
  Entity,
  GroundResponse,
  KnowledgeGraph,
  Relation,
  SourceDocument,
  SuggestionCard,
  TextSpan,
  WritingMap,
} from "./shared/types";

const STORAGE_KEY = "system-x-workspace-v1";

interface Workspace {
  sourceDocuments: SourceDocument[]; // r1*
  entities: Entity[]; // r2*
  relations: Relation[]; // r3*
  knowledgeGraph: KnowledgeGraph | null; // r4
  graphDocIds: string[];
  draft: string; // r5
  draftVersion: number;
  writingMap: WritingMap; // r6
  mapLinks: KnowledgeGraph | null; // r24
  ground: (GroundResponse & { draftVersion: number }) | null; // r8*, r9*, r10*, r11*
  suggestionCards: SuggestionCard[]; // r14 (newest first; earlier rounds kept)
  askResult: (AskResponse & { question: string }) | null; // r15..r21
}

const initial: Workspace = {
  sourceDocuments: [],
  entities: [],
  relations: [],
  knowledgeGraph: null,
  graphDocIds: [],
  draft: "",
  draftVersion: 1,
  writingMap: emptyMap(),
  mapLinks: null,
  ground: null,
  suggestionCards: [],
  askResult: null,
};

function load(): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...initial, ...JSON.parse(raw) };
  } catch {}
  return initial;
}

export default function App() {
  const [ws, setWs] = useState<Workspace>(load);
  const set = (patch: Partial<Workspace>) => setWs((w) => ({ ...w, ...patch }));
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(ws)), 300);
    return () => clearTimeout(t);
  }, [ws]);

  const [busy, setBusy] = useState({ graph: false, ground: false, suggest: false, ask: false });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [mode, setMode] = useState<"write" | "review">("write");
  const [tab, setTab] = useState<"suggest" | "ask">("suggest");
  const [selectedSpan, setSelectedSpan] = useState<TextSpan | null>(null); // r12
  const [pinnedSuggestion, setPinnedSuggestion] = useState<SuggestionCard | null>(null); // r22
  const [pinnedFact, setPinnedFact] = useState<AnswerFact | null>(null); // r23
  const [selectedMapNodeId, setSelectedMapNodeId] = useState<string | null>(null); // r25 / r27

  const run = async <T,>(key: keyof typeof busy, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy((b) => ({ ...b, [key]: true }));
    setErrors((e) => ({ ...e, [key]: null }));
    try {
      return await fn();
    } catch (e: any) {
      setErrors((x) => ({ ...x, [key]: e?.message ?? String(e) }));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  // ---------------------------------------------------------------- P2 / P9 · [tool_2 compose] r5 + r6 → r7
  const [draftContext, setDraftContext] = useState<DraftContext>(() => composeDraftContext(ws.draft, ws.writingMap, ws.draftVersion));
  const lastDraft = useRef(ws.draft);
  useEffect(() => {
    const t = setTimeout(() => {
      let version = ws.draftVersion;
      if (ws.draft !== lastDraft.current) {
        // r5_1 → r5_2: a new version of the draft
        lastDraft.current = ws.draft;
        version = ws.draftVersion + 1;
        set({ draftVersion: version });
      }
      setDraftContext(composeDraftContext(ws.draft, ws.writingMap, version));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.draft, ws.writingMap]);

  // ---------------------------------------------------------------- P1
  const buildGraph = () =>
    run("graph", async () => {
      const r = await api.buildGraph({ sourceDocuments: ws.sourceDocuments });
      set({ ...r, graphDocIds: ws.sourceDocuments.map((d) => d.id), ground: null, askResult: null, mapLinks: null });
      setSelectedSpan(null);
    });
  const graphStale =
    !!ws.knowledgeGraph && ws.graphDocIds.join("|") !== ws.sourceDocuments.map((d) => d.id).join("|");

  // ---------------------------------------------------------------- P3
  const groundDraft = () =>
    run("ground", async () => {
      const ctx = composeDraftContext(ws.draft, ws.writingMap, ws.draftVersion);
      const r = await api.ground({ draft: ws.draft, draftContext: ctx, knowledgeGraph: ws.knowledgeGraph });
      set({ ground: { ...r, draftVersion: ctx.draftVersion } });
      setSelectedSpan(null);
      setMode("review");
    });
  // tool_3 select re-locates grounded spans (r11*) when the draft has been edited since grounding
  const groundedSpans = useMemo(
    () => (ws.ground ? selectGroundedSpans(ws.draft, ws.ground.groundings) : []),
    [ws.draft, ws.ground],
  );

  // ---------------------------------------------------------------- P4
  const requestSuggestion = (span: TextSpan) =>
    run("suggest", async () => {
      const r = await api.suggest({ selectedSpan: span, groundings: ws.ground?.groundings ?? [], knowledgeGraph: ws.knowledgeGraph });
      setWs((w) => ({ ...w, suggestionCards: [r.suggestionCard, ...w.suggestionCards].slice(0, 30) }));
    });
  const selectSpan = (span: TextSpan) => {
    setSelectedSpan(span);
    setTab("suggest");
    requestSuggestion(span);
  };

  // ---------------------------------------------------------------- P5
  const ask = (question: string) =>
    run("ask", async () => {
      const r = await api.ask({ question, draftContext, knowledgeGraph: ws.knowledgeGraph, sourceDocuments: ws.sourceDocuments });
      set({ askResult: { ...r, question } });
    });

  // ---------------------------------------------------------------- P6
  const addToMap = () => {
    if (!ws.knowledgeGraph) return;
    const map2 = addPinsToMap(ws.writingMap, pinnedSuggestion, pinnedFact, ws.knowledgeGraph); // r6_2
    const links = matchMapToGraph(map2, ws.knowledgeGraph); // r24
    const map3 = linkMap(map2, links); // r6_3
    set({ writingMap: map3, mapLinks: links });
    setPinnedSuggestion(null);
    setPinnedFact(null);
  };

  // ---------------------------------------------------------------- P7 / P8 · [tool_3 match]
  const selectedMapNode = ws.writingMap.nodes.find((n) => n.id === selectedMapNodeId) ?? null;
  const draftNodeSpans = useMemo(() => (selectedMapNode ? matchNodeSpans(ws.draft, selectedMapNode) : []), [selectedMapNode, ws.draft]); // r26
  const answerNodeSpans = useMemo(
    () => (selectedMapNode && ws.askResult ? matchNodeSpans(ws.askResult.answer, selectedMapNode) : []),
    [selectedMapNode, ws.askResult],
  ); // r28
  const selectMapNode = (id: string | null) => {
    setSelectedMapNodeId(id);
    if (id) setMode("review");
  };

  const highlightNodeIds = useMemo(() => {
    if (selectedMapNode) return new Set(selectedMapNode.kgNodeIds);
    const g = ws.ground?.groundings.find((x) => x.claimId === selectedSpan?.refId);
    return new Set(g?.matches.map((m) => m.nodeId) ?? []);
  }, [selectedMapNode, ws.ground, selectedSpan]);

  const loadSample = () => {
    set({ sourceDocuments: sampleDocuments, draft: ws.draft || sampleDraft });
  };
  const reset = () => {
    if (!confirm("Clear the whole workspace (sources, graph, draft, map)?")) return;
    setWs(initial);
    lastDraft.current = "";
    setSelectedSpan(null);
    setPinnedFact(null);
    setPinnedSuggestion(null);
    setSelectedMapNodeId(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>System X</h1>
        <span className="muted">Write against your sources: knowledge graph · grounded draft · writing map</span>
        <span className="spacer" />
        <button className="ghost" onClick={reset}>
          Reset workspace
        </button>
      </header>
      {errors.graph && <div className="banner error">Building the knowledge graph failed: {errors.graph}</div>}
      {errors.ground && <div className="banner error">Grounding failed: {errors.ground}</div>}
      <main className="columns">
        <SourcesPanel
          sourceDocuments={ws.sourceDocuments}
          setSourceDocuments={(d) => set({ sourceDocuments: d })}
          knowledgeGraph={ws.knowledgeGraph}
          graphStale={graphStale}
          busy={busy.graph}
          onBuild={buildGraph}
          onLoadSample={loadSample}
          highlightNodeIds={highlightNodeIds}
        />
        <DraftEditor
          draft={ws.draft}
          onDraftChange={(d) => set({ draft: d })}
          mode={mode}
          setMode={setMode}
          draftContext={draftContext}
          groundedSpans={groundedSpans}
          selectedSpan={selectedSpan}
          onSelectSpan={selectSpan}
          draftNodeSpans={draftNodeSpans}
          selectedMapNodeLabel={selectedMapNode?.label ?? null}
          canGround={!!ws.knowledgeGraph && !!ws.draft.trim()}
          grounding={busy.ground}
          groundedVersion={ws.ground?.draftVersion ?? null}
          onGround={groundDraft}
        />
        <div className="right">
          <WritingMapPanel
            writingMap={ws.writingMap}
            pinnedSuggestion={pinnedSuggestion}
            pinnedFact={pinnedFact}
            onClearPins={() => {
              setPinnedFact(null);
              setPinnedSuggestion(null);
            }}
            onAddToMap={addToMap}
            selectedId={selectedMapNodeId}
            onSelectNode={selectMapNode}
          />
          <section className="panel tabs">
            <nav>
              <button className={tab === "suggest" ? "on" : ""} onClick={() => setTab("suggest")}>
                Suggestions {ws.suggestionCards.length > 0 && <span className="count">{ws.suggestionCards.length}</span>}
              </button>
              <button className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>
                Ask the sources
              </button>
            </nav>
            {tab === "suggest" ? (
              <SuggestionsPanel
                selectedSpan={selectedSpan}
                grounding={ws.ground?.groundings.find((g) => g.claimId === selectedSpan?.refId) ?? null}
                knowledgeGraph={ws.knowledgeGraph}
                cards={ws.suggestionCards}
                loading={busy.suggest}
                error={errors.suggest ?? null}
                onRegenerate={() => selectedSpan && requestSuggestion(selectedSpan)}
                pinnedId={pinnedSuggestion?.id ?? null}
                onTogglePin={(c) => setPinnedSuggestion(pinnedSuggestion?.id === c.id ? null : c)}
                hasGrounding={!!ws.ground}
              />
            ) : (
              <AskPanel
                disabled={!ws.knowledgeGraph}
                loading={busy.ask}
                error={errors.ask ?? null}
                result={ws.askResult}
                onAsk={ask}
                pinnedId={pinnedFact?.id ?? null}
                onTogglePin={(f) => setPinnedFact(pinnedFact?.id === f.id ? null : f)}
                answerNodeSpans={answerNodeSpans}
                selectedMapNodeLabel={selectedMapNode?.label ?? null}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
