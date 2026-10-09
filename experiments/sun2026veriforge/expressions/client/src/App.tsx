import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, store } from './api.ts';
import DraftEditor, { type Flash } from './components/DraftEditor.tsx';
import CanvasView from './components/CanvasView.tsx';
import CardsTray from './components/CardsTray.tsx';
import ChatPanel from './components/ChatPanel.tsx';
import SourcesPanel from './components/SourcesPanel.tsx';
import {
  addCardsToCanvas,
  composeCanvasEdges,
  composeHighlightCard,
  composeQueryCards,
  composeSemanticFrame,
  findQueryTurn,
  linkAnswerToCards,
  locateOriginSpan,
  matchRelatedEdges,
  removeCanvasNode,
  selectHighlightSpans,
  shiftSpans,
  uid,
} from '../../shared/tools.ts';
import type {
  AnalyzeResponse,
  AskResponse,
  Card,
  CanvasGraph,
  CanvasNode,
  ChatTurn,
  Fact,
  HighlightCard,
  HighlightSpan,
  KnowledgeGraph,
} from '../../shared/types.ts';

const S = {
  draft: store('draft', ''),
  analysis: store<{ facts: Fact[]; spans: HighlightSpan[]; draft: string }>('analysis', { facts: [], spans: [], draft: '' }),
  cards: store<Card[]>('cards', []),
  canvas: store<CanvasGraph>('canvas', { nodes: [], edges: [] }),
  turns: store<ChatTurn[]>('turns', []),
  auto: store('autoCheck', true),
};

const emptyKg: KnowledgeGraph = { nodes: [], links: [], documents: [], builtAt: '' };

export default function App() {
  const [kg, setKg] = useState<KnowledgeGraph>(emptyKg);
  const [status, setStatus] = useState<{ model: string; embedder: string } | null>(null);

  // draft_n (artifact language)
  const [draft, setDraft] = useState(S.draft.load);
  // candidate_facts_1* + highlight_spans_1*
  const initialAnalysis = useMemo(S.analysis.load, []);
  const [facts, setFacts] = useState<Fact[]>(initialAnalysis.facts);
  const [spans, setSpans] = useState<HighlightSpan[]>(initialAnalysis.spans);
  const analyzedDraft = useRef(initialAnalysis.draft);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [autoCheck, setAutoCheck] = useState(S.auto.load);

  // highlight_card_1, query_cards_1*
  const [cards, setCards] = useState<Card[]>(S.cards.load);
  const [explaining, setExplaining] = useState<{ spanId: string; text: string; cardId?: string } | null>(null);
  const [explainError, setExplainError] = useState('');
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  // canvas_n (artifact graph)
  const [canvas, setCanvas] = useState<CanvasGraph>(S.canvas.load);
  // query turns: query_1, query_answer_1, text_card_links_1
  const [turns, setTurns] = useState<ChatTurn[]>(S.turns.load);

  const [flash, setFlash] = useState<Flash | null>(null);
  const [flashTurn, setFlashTurn] = useState<{ id: string; nonce: number } | null>(null);
  const [tab, setTab] = useState<'ask' | 'sources'>('ask');

  useEffect(() => {
    api<KnowledgeGraph>('/kg').then(setKg).catch(() => {});
    const poll = () => api<{ model: string; embedder: string }>('/status').then(setStatus).catch(() => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => S.draft.save(draft), [draft]);
  useEffect(() => S.analysis.save({ facts, spans, draft: analyzedDraft.current }), [facts, spans]);
  useEffect(() => S.cards.save(cards), [cards]);
  useEffect(() => S.canvas.save(canvas), [canvas]);
  useEffect(() => S.turns.save(turns.filter((t) => t.status !== 'pending')), [turns]);
  useEffect(() => S.auto.save(autoCheck), [autoCheck]);

  // Processes 2 & 9 — [tool_2 compose]: draft + canvas → semantic_frame (recomputed on every change)
  const frame = useMemo(() => composeSemanticFrame(draft, canvas), [draft, canvas]);

  // Process 9 — [human modify]: draft_1 → draft_2 (highlight spans follow the edit)
  const draftRef = useRef(draft);
  const onDraftChange = (next: string) => {
    setSpans((s) => shiftSpans(draftRef.current, next, s));
    draftRef.current = next;
    setDraft(next);
  };

  // Process 3 — extract → translate → match → select (server), spans re-selected against the current draft
  const analyze = useCallback(async () => {
    const sent = draftRef.current;
    if (!sent.trim() || !kg.nodes.length) return;
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      const res = await api<AnalyzeResponse>('/analyze', { draft: sent, frame: composeSemanticFrame(sent, canvas) });
      const current = draftRef.current;
      analyzedDraft.current = sent;
      setFacts(res.facts);
      setSpans(current === sent ? res.spans : selectHighlightSpans(current, res.facts));
    } catch (e) {
      setAnalyzeError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }, [kg, canvas]);

  // Trigger for process 3: 2.5 s after typing stops (when Auto-check is on)
  useEffect(() => {
    if (!autoCheck || draft === analyzedDraft.current || !kg.nodes.length) return;
    const t = setTimeout(() => void analyze(), 2500);
    return () => clearTimeout(t);
  }, [draft, autoCheck, kg, analyze]);

  // Process 4 — [human select] clicked_span → [model_1 generate]~ → [tool_3 compose] highlight_card
  const explain = async (span: HighlightSpan, replaceCardId?: string) => {
    setExplaining({ spanId: span.id, text: span.text, cardId: replaceCardId });
    setExplainError('');
    const spanFacts = replaceCardId
      ? (cards.find((c) => c.id === replaceCardId)?.facts ?? [])
      : facts.filter((f) => span.factIds.includes(f.id));
    try {
      const { explanation } = await api<{ explanation: string }>('/explain', { span, facts: spanFacts });
      const card = composeHighlightCard(explanation, span, spanFacts);
      if (replaceCardId) {
        setCards((cs) => cs.map((c) => (c.id === replaceCardId ? { ...(c as HighlightCard), explanation } : c)));
      } else {
        setCards((cs) => [card, ...cs]);
        setActiveCardId(card.id);
      }
    } catch (e) {
      setExplainError((e as Error).message);
    } finally {
      setExplaining(null);
    }
  };

  const onSpanClick = (span: HighlightSpan) => {
    const existing = cards.find((c) => c.kind === 'highlight' && c.span.start === span.start && c.span.text === span.text);
    if (existing) setActiveCardId(existing.id);
    else void explain(span);
  };

  // Process 5 — [human specify] query → extract → translate → match → generate~ → compose cards → match links
  const ask = async (query: string) => {
    const turn: ChatTurn = { id: uid('turn'), query, status: 'pending' };
    setTurns((ts) => [...ts, turn]);
    try {
      const res = await api<AskResponse>('/ask', { query, frame });
      const qCards = composeQueryCards(turn.id, res.facts);
      const links = linkAnswerToCards(res.answer, qCards);
      setCards((cs) => [...qCards, ...cs]);
      setTurns((ts) =>
        ts.map((t) => (t.id === turn.id ? { ...t, status: 'done', answer: res.answer, facts: res.facts, cardIds: qCards.map((c) => c.id), links } : t)),
      );
    } catch (e) {
      setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: 'error', error: (e as Error).message } : t)));
    }
  };

  // Process 6 — [human select] cards → [tool_3 compose] canvas_2 → [tool_1 match] related_edges → [tool_3 compose] canvas_3
  const addToCanvas = (cardIds: string[], position?: { x: number; y: number }) => {
    const chosen = cards.filter((c) => cardIds.includes(c.id));
    if (!chosen.length) return;
    setCanvas((c1) => {
      const c2 = addCardsToCanvas(c1, chosen, position);
      const related = matchRelatedEdges(c2, kg);
      return composeCanvasEdges(c2, related);
    });
    setSelectedCardIds([]);
  };
  const removeNode = (nodeId: string) =>
    setCanvas((c) => {
      const next = removeCanvasNode(c, nodeId);
      return composeCanvasEdges(next, matchRelatedEdges(next, kg));
    });
  const moveNode = (nodeId: string, position: { x: number; y: number }) =>
    setCanvas((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)) }));

  // Process 7 — gold node → [tool_3 match] origin_span;  Process 8 — silver node → [tool_3 match] query_turn
  const onNodeClick = (node: CanvasNode) => {
    setActiveCardId(node.cardId);
    const card = cards.find((c) => c.id === node.cardId);
    if (!card) return;
    if (node.kind === 'gold' && card.kind === 'highlight') {
      const origin = locateOriginSpan(draftRef.current, card.span);
      const nonce = Date.now();
      setFlash(origin ? { ...origin, nonce } : { start: -1, end: -1, nonce, missing: card.span.text });
      setTimeout(() => setFlash((f) => (f?.nonce === nonce ? null : f)), 4000);
    } else {
      const turn = findQueryTurn(node, cards, turns);
      if (turn) {
        setTab('ask');
        setFlashTurn({ id: turn.id, nonce: Date.now() });
      }
    }
  };

  const removeCard = (id: string) => {
    setCards((cs) => cs.filter((c) => c.id !== id));
    setCanvas((c) => {
      const node = c.nodes.find((n) => n.cardId === id);
      if (!node) return c;
      const next = removeCanvasNode(c, node.id);
      return composeCanvasEdges(next, matchRelatedEdges(next, kg));
    });
  };

  const onKgBuilt = (next: KnowledgeGraph) => {
    setKg(next);
    analyzedDraft.current = '';
    setFacts([]);
    setSpans([]);
  };

  const highlightCount = spans.length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">System X</div>
        <div className="kg-status">
          {kg.nodes.length ? (
            <span>
              Knowledge graph: <b>{kg.nodes.length}</b> entities · <b>{kg.links.length}</b> relations · {kg.documents.length} sources
            </span>
          ) : (
            <span className="warn">No knowledge graph yet — add sources in the right panel.</span>
          )}
        </div>
        <div className="model-status">
          {status ? `model_1: claude ${status.model} · model_2: ${status.embedder}` : 'server offline'}
        </div>
      </header>

      <main className="columns">
        <section className="col col-draft">
          <div className="col-head">
            <h2>Draft</h2>
            <div className="row gap">
              <label className="toggle">
                <input type="checkbox" checked={autoCheck} onChange={(e) => setAutoCheck(e.target.checked)} /> Auto-check
              </label>
              <button onClick={() => void analyze()} disabled={analyzing || !kg.nodes.length || !draft.trim()}>
                {analyzing ? 'Checking…' : 'Check draft'}
              </button>
            </div>
          </div>
          <DraftEditor
            value={draft}
            spans={spans}
            flash={flash}
            activeSpanText={explaining?.text}
            onChange={onDraftChange}
            onSpanClick={onSpanClick}
          />
          <div className="draft-foot">
            <span className="muted">
              {analyzing ? 'Matching draft against the knowledge graph…' : `${highlightCount} highlight${highlightCount === 1 ? '' : 's'} — click one to explain it`}
            </span>
            {analyzeError && <span className="error">{analyzeError}</span>}
            {flash?.missing && <span className="error">“{flash.missing}” is no longer in the draft.</span>}
          </div>
          <div className="frame">
            <div className="frame-title">Semantic frame</div>
            {frame.focus && <div className="frame-focus">{frame.focus}</div>}
            <div className="chips">
              {frame.keyTerms.map((t) => <span key={t} className="chip">{t}</span>)}
              {frame.canvasEntities.map((t) => <span key={`c-${t}`} className="chip chip-canvas">◆ {t}</span>)}
            </div>
          </div>
        </section>

        <section className="col col-canvas">
          <div className="col-head">
            <h2>Canvas</h2>
            <span className="muted small">gold = from draft highlights · silver = from questions · click a node to jump to its origin</span>
          </div>
          <CanvasView
            canvas={canvas}
            cards={cards}
            activeCardId={activeCardId}
            onDropCards={addToCanvas}
            onNodeClick={onNodeClick}
            onNodeMove={moveNode}
            onNodeRemove={removeNode}
          />
          <CardsTray
            cards={cards}
            canvas={canvas}
            selected={selectedCardIds}
            activeCardId={activeCardId}
            explaining={explaining}
            explainError={explainError}
            onToggle={(id) => setSelectedCardIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            onAdd={addToCanvas}
            onActivate={setActiveCardId}
            onRegenerate={(card) => void explain(card.span, card.id)}
            onRemove={removeCard}
          />
        </section>

        <section className="col col-side">
          <div className="tabs">
            <button className={tab === 'ask' ? 'active' : ''} onClick={() => setTab('ask')}>Ask the knowledge graph</button>
            <button className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}>Sources &amp; graph</button>
          </div>
          <div className={tab === 'ask' ? 'tab-body' : 'hidden'}>
            <ChatPanel
              turns={turns}
              cards={cards}
              disabled={!kg.nodes.length}
              activeCardId={activeCardId}
              flashTurn={flashTurn}
              onAsk={(q) => void ask(q)}
              onActivateCard={setActiveCardId}
              onClear={() => setTurns([])}
            />
          </div>
          <div className={tab === 'sources' ? 'tab-body' : 'hidden'}>
            <SourcesPanel kg={kg} canvas={canvas} onBuilt={onKgBuilt} visible={tab === 'sources'} />
          </div>
        </section>
      </main>
    </div>
  );
}
