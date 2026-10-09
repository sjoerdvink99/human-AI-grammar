import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.ts";
import { DraftEditor, type DraftEditorHandle } from "./DraftEditor.tsx";
import { KnowledgeCanvas } from "./KnowledgeCanvas.tsx";
import { KnowledgeCardView } from "./KnowledgeCard.tsx";
import { QueryPanel } from "./QueryPanel.tsx";
import { SourcesDialog } from "./SourcesDialog.tsx";
import { locateOriginSpan, reanchor } from "./align.ts";
import { addCardToCanvas, mergeRelatedEdges, removeNode } from "./canvasOps.ts";
import type { Canvas, CanvasNode, Fact, GraphStats, HighlightSpan, KnowledgeCard, QueryTurn, SemanticFrame } from "../../shared/types.ts";

const TYPING_PAUSE_MS = 5000; // process 3 trigger
const FRAME_DEBOUNCE_MS = 1500; // process 2 / 9 trigger

function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(v)), [key, v]);
  return [v, setV] as const;
}

interface OpenCard {
  span: HighlightSpan;
  card: KnowledgeCard | null;
  loading: boolean;
  error: string | null;
  pos: { top: number; left: number };
}

export default function App() {
  const [draft, setDraft] = usePersisted("sx.draft", "");
  const [canvas, setCanvas] = usePersisted<Canvas>("sx.canvas", { nodes: [], edges: [] });
  const [turns, setTurns] = usePersisted<QueryTurn[]>("sx.turns", []);
  const [spans, setSpans] = useState<HighlightSpan[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [scanState, setScanState] = useState<"idle" | "waiting" | "scanning" | "error">("idle");
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [originSpan, setOriginSpan] = useState<{ start: number; end: number } | null>(null);
  const [focusTurn, setFocusTurn] = useState<{ id: string; nonce: number } | null>(null);
  const [frame, setFrame] = useState<SemanticFrame | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [queryPending, setQueryPending] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [relating, setRelating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editorRef = useRef<DraftEditorHandle>(null);

  const refreshStats = useCallback(() => api.graph().then(setStats).catch(() => {}), []);
  useEffect(() => { refreshStats(); }, [refreshStats]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Process 2 / 9 — [tool_2 compose]: draft + canvas -> semantic_frame (asynchronous, debounced)
  const topology = useMemo(
    () => JSON.stringify([canvas.nodes.map((n) => n.card.concept), canvas.edges.map((e) => [e.source, e.label, e.target])]),
    [canvas],
  );
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  useEffect(() => {
    const t = setTimeout(() => api.frame(draft, canvasRef.current).then(setFrame).catch(() => {}), FRAME_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, topology]);

  // Process 3 — proactive highlighting after a five-second typing pause
  useEffect(() => {
    if (draft.trim().length < 20 || !stats?.entityCount) return;
    setScanState("waiting");
    const requested = draft;
    let cancelled = false;
    const t = setTimeout(async () => {
      setScanState("scanning");
      try {
        // make sure the semantic frame reflects this draft before retrieval
        setFrame(await api.frame(requested, canvasRef.current));
        const r = await api.highlight(requested);
        if (cancelled) return;
        setFacts(r.facts);
        setSpans(reanchor(draftRef.current, r.spans));
        setScanState("idle");
      } catch {
        if (!cancelled) setScanState("error");
      }
    }, TYPING_PAUSE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [draft, stats?.entityCount]);

  // Process 9 — [human modify]: the author edits the draft (draft_1 -> draft_2)
  const onDraftChange = (next: string) => {
    setDraft(next);
    setSpans((s) => reanchor(next, s));
    setOriginSpan(null);
  };

  // Process 4 — [human select] clicked_span -> [model_1 generate]~ -> [tool_3 compose] highlight_card
  const loadCard = async (span: HighlightSpan, pos: OpenCard["pos"]) => {
    setOpenCard({ span, card: null, loading: true, error: null, pos });
    try {
      const card = await api.card(draftRef.current, span, facts);
      setOpenCard((o) => (o && o.span.id === span.id ? { ...o, card, loading: false } : o));
    } catch (e) {
      setOpenCard((o) => (o && o.span.id === span.id ? { ...o, loading: false, error: String((e as Error).message) } : o));
    }
  };
  const onClickSpan = (span: HighlightSpan) => {
    const r = editorRef.current?.rectOfSpan(span.id);
    const left = Math.min(Math.max(8, (r?.left ?? 80)), window.innerWidth - 400);
    const top = Math.min((r?.bottom ?? 120) + 8, window.innerHeight - 320);
    if (openCard?.span.id === span.id && openCard.card) return;
    loadCard(span, { top, left });
  };

  // Process 5 — [human specify] query -> answer + cards + links
  const ask = async (q: string) => {
    setQueryPending(q);
    setQueryError(null);
    try {
      const turn = await api.query(q);
      setTurns((t) => [...t, turn]);
    } catch (e) {
      setQueryError(String((e as Error).message));
    } finally {
      setQueryPending(null);
    }
  };

  // Process 6 — [human select] card -> [tool_3 compose] -> [tool_1 match] -> [tool_3 compose]
  const addToCanvas = async (card: KnowledgeCard) => {
    const canvas2 = addCardToCanvas(canvasRef.current, card);
    setCanvas(canvas2);
    setRelating(true);
    try {
      const related = await api.relate(canvas2.nodes.map((n) => ({ id: n.id, concept: n.card.concept, entityKeys: n.card.entityKeys })));
      setCanvas((c) => mergeRelatedEdges(c, related));
    } catch (e) {
      setNotice(`Could not compute connections: ${(e as Error).message}`);
    } finally {
      setRelating(false);
    }
  };
  const onRemove = useCallback((id: string) => setCanvas((c) => removeNode(c, id)), [setCanvas]);

  // Process 7 / 8 — [human select] node -> [tool_3 match] origin_span / query_turn
  const onNodeClick = (n: CanvasNode) => {
    if (n.card.origin.kind === "highlight") {
      const loc = locateOriginSpan(draftRef.current, n.card.origin);
      if (loc) setOriginSpan({ ...loc });
      else setNotice(`“${n.card.origin.spanText}” is no longer in the draft.`);
    } else {
      const turnId = n.card.origin.turnId;
      if (turns.some((t) => t.id === turnId)) setFocusTurn({ id: turnId, nonce: Date.now() });
      else setNotice("The conversation turn for this card is no longer available.");
    }
  };

  const canvasCardIds = useMemo(() => new Set(canvas.nodes.map((n) => n.card.id)), [canvas.nodes]);
  const status =
    !stats?.entityCount ? "Upload domain sources to enable knowledge highlighting"
    : scanState === "scanning" ? "Looking for knowledge gaps…"
    : scanState === "waiting" ? "Highlights update after a 5 s pause"
    : scanState === "error" ? "Highlighting failed — keep typing to retry"
    : "Up to date";

  return (
    <div className="app">
      <header className="topbar">
        <h1>System X <span className="muted">· knowledge-aware fiction writing</span></h1>
        <div className="frame" title={frame ? `Semantic Frame v${frame.version}\nTerms: ${frame.salientTerms.join(", ")}\nCanvas: ${frame.canvasTopics.join(", ")}` : "No semantic frame yet"}>
          <span className="muted small">Context</span>
          {(frame?.salientTerms ?? []).slice(0, 6).map((t) => <span key={t} className="chip">{t}</span>)}
          {frame && frame.canvasTopics.length > 0 && <span className="chip canvas">+{frame.canvasTopics.length} canvas topics</span>}
        </div>
        <button onClick={() => setShowSources(true)}>
          Sources {stats ? `(${stats.documents.length} docs · ${stats.entityCount} entities)` : ""}
        </button>
      </header>
      <main className="columns">
        <DraftEditor
          ref={editorRef}
          draft={draft}
          spans={spans}
          activeSpanId={openCard?.span.id ?? null}
          originSpan={originSpan}
          status={status}
          onChange={onDraftChange}
          onClickSpan={onClickSpan}
        />
        <KnowledgeCanvas canvas={canvas} relating={relating} onChange={setCanvas} onRemove={onRemove} onNodeClick={onNodeClick} />
        <QueryPanel
          turns={turns}
          pending={queryPending}
          error={queryError}
          focusTurn={focusTurn}
          canvasCardIds={canvasCardIds}
          onAsk={ask}
          onAdd={addToCanvas}
        />
      </main>
      {openCard && (
        <div className="popover" style={{ top: openCard.pos.top, left: openCard.pos.left }}>
          {openCard.loading && (
            <div className="kcard gold"><header><h3>{openCard.span.concept}</h3><button className="icon" onClick={() => setOpenCard(null)}>×</button></header><p className="muted"><span className="spinner" /> Writing an explanation from your sources…</p></div>
          )}
          {openCard.error && (
            <div className="kcard gold"><header><h3>{openCard.span.concept}</h3><button className="icon" onClick={() => setOpenCard(null)}>×</button></header><p className="error">{openCard.error}</p><footer><button onClick={() => loadCard(openCard.span, openCard.pos)}>Retry</button></footer></div>
          )}
          {openCard.card && (
            <KnowledgeCardView
              card={openCard.card}
              onCanvas={canvasCardIds.has(openCard.card.id)}
              onAdd={addToCanvas}
              onRegenerate={canvasCardIds.has(openCard.card.id) ? undefined : () => loadCard(openCard.span, openCard.pos)}
              onClose={() => setOpenCard(null)}
            />
          )}
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
      {showSources && <SourcesDialog stats={stats} onClose={() => setShowSources(false)} onUpdated={refreshStats} />}
    </div>
  );
}
