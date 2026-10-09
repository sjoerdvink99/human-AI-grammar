// HTTP entry: every design operation (model or tool_2) is exposed as POST /api/op/<name>.
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ops from './ops.js';
import { runForErrors, runTests } from './browser.js';

const registry: Record<string, (input: any) => Promise<unknown>> = {
  // process 1
  translateConceptGraph: ops.translateConceptGraph,
  generateScenarios: ops.generateScenarios,
  translateScenarioGraph: ops.translateScenarioGraph,
  generateLearningGoals: ops.generateLearningGoals,
  selectLearningGoalGraph: ops.selectLearningGoalGraph,
  extractExperimentFactors: ops.extractExperimentFactors,
  generateProcedure: ops.generateProcedure,
  generateUiGraph: ops.generateUiGraph,
  translateSimulationCode: ops.translateSimulationCode,
  // process 3
  runForErrors: (i: { simulation_code: string }) => runForErrors(i.simulation_code),
  fixJavascriptErrors: ops.fixJavascriptErrors,
  generateTestCases: ops.generateTestCases,
  runTests: (i: { simulation_code: string; test_cases: any[] }) => runTests(i.simulation_code, i.test_cases),
  evaluateTestResults: ops.evaluateTestResults,
  repairFromAssessment: ops.repairFromAssessment,
  // process 4
  selectRepairTarget: ops.selectRepairTarget,
  generateSuggestedRepair: ops.generateSuggestedRepair,
  applyRepairToCode: ops.applyRepairToCode,
  // process 5
  selectRepairTargetForIssue: ops.selectRepairTargetForIssue,
  generateSuggestedChange: ops.generateSuggestedChange,
  reviseCodeForGraph: ops.reviseCodeForGraph,
  // process 6
  extractAssumptions: ops.extractAssumptions,
  reviseCodeForAssumptions: ops.reviseCodeForAssumptions,
  // process 7
  translateSketchToSvg: ops.translateSketchToSvg,
  replaceGraphic: ops.replaceGraphic,
  // process 8
  matchSubgraph: ops.matchSubgraph,
};

const app = express();
app.use(express.json({ limit: '50mb' }));

app.post('/api/op/:name', async (req, res) => {
  const fn = registry[req.params.name];
  if (!fn) return res.status(404).json({ error: `unknown operation ${req.params.name}` });
  try {
    res.json(await fn(req.body));
  } catch (e) {
    console.error(`[op] ${req.params.name} failed:`, e);
    res.status(500).json({ error: (e as Error).message });
  }
});

const dist = resolve(process.cwd(), 'dist');
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8642);
const server = app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
server.requestTimeout = 0;
server.headersTimeout = 0;
