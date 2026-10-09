// HTTP API. Each route runs one process (or one part of a process) of the design, in order.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InteractionLog, InteractionState, ResolvedInstruction, SceneGraph } from '../shared/types';
import { hashString, mulberry32 } from '../shared/rng';
import { embedRequest } from './model3_embedding';
import { transcribe, warmUp } from './model1_asr';
import { affordanceQuery, scoreKeys } from './rerankers';
import {
  affordancePool, composeGenerationConstraints, matchCandidateScenes, sampleAffordances, sampleScenes, toAffordanceRows, toSceneRows,
} from './tool3_retrieval';
import { buildRetrievalTrace, constraintReport, generateRoomConstraints, generateSceneGraph } from './tool1_scenegen';
import { decomposeEdit, resolveReferences } from './model2_editor';
import {
  assignFunctionalZones, composePreferenceMemory, composeSessionPayload, extractGeometricContext, extractObjectFeatures, groundAffordances,
} from './tool4_context';
import { expandHierarchicalContext, extractAffordances } from './model6_preferences';
import { evaluateRealization } from './model7_vlm';
import { computeRewards, trainPolicy } from './tool5_optimizer';
import { TMP_DIR, loadMemory, loadPolicy, loadTrace, resetAll, saveMemory, savePolicy, saveTrace } from './store';

const app = express();
app.use(express.json({ limit: '20mb' }));

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => fn(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: String(e?.message ?? e) });
    else res.end(JSON.stringify({ step: 'error', error: String(e?.message ?? e) }) + '\n');
  });

/** NDJSON stream helper so the client can show each step as it completes. */
function stream(res: express.Response) {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  return (step: string, data: unknown) => res.write(JSON.stringify({ step, data }) + '\n');
}

// ------------------------------------------------------------------ process 1: generate personalized scene
app.post('/api/scenes', wrap(async (req, res) => {
  const request = String(req.body?.request ?? '').trim();
  if (!request) return res.status(400).json({ error: 'request is empty' });
  const sessionId = `s_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const memory = loadMemory(); // preference_memory_1
  const policy = loadPolicy(); // retrieval_policy_1
  const rnd = mulberry32(hashString(sessionId));

  const { embedding: queryEmbedding, model: embeddingModel } = await embedRequest(request); // model_3 translate
  const candidates = matchCandidateScenes(memory, queryEmbedding, policy); // tool_3 match
  const sceneLogits = scoreKeys(policy.sceneReranker, queryEmbedding, candidates.map((c) => c.scene.key)); // model_4 match
  const scoredScenes = toSceneRows(candidates, sceneLogits, policy.temperature);
  const sampledScenes = sampleScenes(candidates, scoredScenes, policy, rnd); // tool_3 select
  const pool = affordancePool(sampledScenes);
  const aQuery = affordanceQuery(queryEmbedding, sampledScenes.map((s) => s.key));
  const affLogits = scoreKeys(policy.affordanceReranker, aQuery, pool.map((a) => a.key)); // model_5 match
  const scoredAffordances = toAffordanceRows(pool, affLogits, policy.temperature);
  const sampledAffordances = sampleAffordances(pool, scoredAffordances, policy, rnd); // tool_3 select
  const roomConstraints = generateRoomConstraints(request, sampledScenes); // tool_1 generate
  const retrievalTrace = buildRetrievalTrace({
    sessionId, request, policyVersion: policy.version, memoryVersion: memory.version, queryEmbedding,
    candidates: candidates.map((c) => c.scene), sampledScenes, affordanceQuery: aQuery, pool, sampledAffordances,
  });
  saveTrace(retrievalTrace);
  const generationConstraints = composeGenerationConstraints(roomConstraints, sampledAffordances, hashString(sessionId)); // tool_3 compose
  const sceneGraph = generateSceneGraph(generationConstraints); // tool_1 generate

  res.json({
    sessionId,
    memoryVersion: memory.version,
    policyVersion: policy.version,
    embeddingModel,
    queryEmbedding,
    candidateScenes: candidates.map((c) => ({ id: c.scene.id, request: c.scene.request, cosine: c.cosine })),
    scoredScenes,
    sampledScenes: sampledScenes.map((s) => ({ id: s.id, request: s.request, roomType: s.room.roomType, affordances: s.affordances.length })),
    scoredAffordances,
    sampledAffordances: sampledAffordances.map((a) => ({ id: a.id, statement: a.statement, constraint: a.constraint })),
    roomConstraints,
    generationConstraints,
    constraintReport: constraintReport(sceneGraph, generationConstraints.constraints),
    sceneGraph,
  });
}));

// ------------------------------------------------------------------ process 2: edit through speech + controllers
app.post('/api/transcribe', express.raw({ type: 'application/octet-stream', limit: '30mb' }), wrap(async (req, res) => {
  const buf = req.body as Buffer;
  const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  res.json({ transcript: await transcribe(pcm) }); // model_1 translate
}));

app.post('/api/edit/resolve', wrap(async (req, res) => {
  const state = req.body?.interactionState as InteractionState;
  if (!state?.transcript) return res.status(400).json({ error: 'empty transcript' });
  res.json({ resolvedInstruction: await resolveReferences(state) }); // model_2 translate
}));

app.post('/api/edit/decompose', wrap(async (req, res) => {
  const state = req.body?.interactionState as InteractionState;
  const resolved = req.body?.resolvedInstruction as ResolvedInstruction;
  res.json({ editSubtasks: await decomposeEdit(resolved, state) }); // model_2 decompose
}));

// ------------------------------------------------------------------ process 3: learn preferences, update policy
app.post('/api/learn/context', wrap(async (req, res) => {
  const { sessionId, scene, interactionLog } = req.body as { sessionId: string; scene: SceneGraph; interactionLog: InteractionLog };
  const trace = loadTrace(sessionId);
  if (!trace) return res.status(404).json({ error: 'unknown session' });
  const emit = stream(res);
  const memory = loadMemory();

  const payload = composeSessionPayload(sessionId, trace.request, scene, interactionLog); // tool_4 compose
  emit('session_payload', { objects: payload.scene.objects.length, edits: payload.interactionLog.entries.length, relations: payload.scene.relations.length });
  const features = extractObjectFeatures(payload); // tool_4 extract
  emit('object_features', features);
  const zones = assignFunctionalZones(features, payload.scene); // tool_4 assign
  emit('functional_zones', zones);
  const geometric = extractGeometricContext(zones, payload.scene); // tool_4 extract
  emit('geometric_context', geometric);
  const hier = await expandHierarchicalContext(geometric, payload); // model_6 expand
  emit('hierarchical_context', hier);
  const affordances = await extractAffordances(hier, payload); // model_6 extract
  emit('affordances', affordances);
  const grounded = groundAffordances(affordances); // tool_4 translate
  emit('spatial_constraints', grounded);
  const memory2 = composePreferenceMemory(memory, payload, trace, grounded.constraints); // tool_4 compose
  saveMemory(memory2);
  emit('preference_memory', { version: memory2.version, scenes: memory2.scenes.length, added: grounded.constraints.length });
  res.end();
}));

app.post('/api/learn/evaluate', wrap(async (req, res) => {
  const { sessionId, topdownPng, legend } = req.body as { sessionId: string; topdownPng: string; legend: string };
  const trace = loadTrace(sessionId);
  if (!trace) return res.status(404).json({ error: 'unknown session' });
  const emit = stream(res);
  const file = path.join(TMP_DIR, `${sessionId}_topdown.png`);
  fs.writeFileSync(file, Buffer.from(topdownPng.replace(/^data:image\/png;base64,/, ''), 'base64'));

  const retrieved = trace.affordances.candidates.filter((c) => trace.affordances.chosen.includes(c.id)).map((c) => ({ id: c.id, statement: c.statement }));
  const signals = await evaluateRealization(file, legend, retrieved); // model_7 evaluate
  emit('realization_signals', signals);
  const rewards = computeRewards(signals, trace); // tool_5 evaluate
  emit('rewards', rewards);
  const policy = loadPolicy();
  const { policy: policy2, report } = trainPolicy(policy, trace, rewards); // tool_5 train
  if (report.updated) savePolicy(policy2);
  emit('retrieval_policy', { version: policy2.version, report, history: policy2.history });
  res.end();
}));

// ------------------------------------------------------------------ inspection
app.get('/api/state', (_req, res) => {
  const m = loadMemory();
  const p = loadPolicy();
  const norm = (M: number[][]) => Math.sqrt(M.flat().reduce((s, v) => s + v * v, 0));
  res.json({
    memory: { version: m.version, scenes: m.scenes.map((s) => ({ id: s.id, request: s.request, roomType: s.room.roomType, createdAt: s.createdAt, affordances: s.affordances.map((a) => ({ id: a.id, statement: a.statement })) })) },
    policy: {
      version: p.version, temperature: p.temperature, kScenes: p.kScenes, kAffordances: p.kAffordances, baseline: p.baseline, learningRate: p.learningRate,
      sceneLoraNorm: { A: norm(p.sceneReranker.A), B: norm(p.sceneReranker.B) },
      affordanceLoraNorm: { A: norm(p.affordanceReranker.A), B: norm(p.affordanceReranker.B) },
      history: p.history,
    },
  });
});

app.post('/api/reset', (_req, res) => { resetAll(); res.json({ ok: true }); });

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist')));
}

const PORT = Number(process.env.PORT ?? 8791);
app.listen(PORT, () => {
  console.log(`System X server on http://localhost:${PORT}`);
  warmUp();
  embedRequest('warm up').catch(() => {});
});
