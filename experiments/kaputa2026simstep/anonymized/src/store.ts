// Application state, named after the design's identifiers (see PLAN.md), plus the
// orchestration of process 1 (design pipeline) and process 3 (test & revise).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { op } from './api';
import type { CodeVersion, DataSpec, Graph, TestCase, TestResult } from './shared/types';
import { executeForErrors, executeTests } from './tools/sandbox';

export type Stage =
  | 'request' // waiting for r1
  | 'intent' // r2 shown, human may modify (process 2), then continue
  | 'concepts' // r3* shown, human selects r4
  | 'build' // r6* shown, human selects r7
  | 'generating' // model steps r8..r12_1
  | 'testing' // process 3
  | 'done';

export interface Versioned<T> {
  id: string;
  value: T;
}

interface State {
  stage: Stage;
  busy: string | null;
  error: string | null;
  log: { at: number; step: string }[];

  request: string; // r1
  intentGraphs: Versioned<Graph>[]; // r2_1, r2_2, …
  concepts: string[]; // r3*
  concept: string; // r4
  designGraph: Graph | null; // r5
  buildOptions: string[]; // r6*
  buildInstruction: string; // r7
  scopeGraph: Graph | null; // r8
  dataSpec: DataSpec | null; // r9
  plan: string; // r10
  componentGraphs: Versioned<Graph>[]; // r11_1, r11_2, …
  codeVersions: CodeVersion[]; // r12_1, r12_2, r12_3, r25_4, …
  currentCodeIndex: number;
  runErrors: string[]; // r13*
  testCases: TestCase[]; // r14*
  testResults: TestResult[]; // r15* + r16*
  critique: string; // r17
  highlightNodes: string[]; // r40
  highlightReason: string;

  // actions
  setRequest(r: string): void;
  startDesign(): Promise<void>;
  modifyIntentGraph(g: Graph): void; // process 2
  generateConcepts(): Promise<void>;
  selectConcept(c: string): Promise<void>;
  regenerateBuildOptions(): Promise<void>;
  selectBuildInstruction(b: string): Promise<void>;
  runProcess3(): Promise<void>;
  addCode(id: string, label: string, code: string): void;
  setCurrentCode(i: number): void;
  addComponentGraph(g: Graph): string;
  setHighlight(ids: string[], reason?: string): void;
  reset(): void;
  run<T>(label: string, fn: () => Promise<T>): Promise<T>;
}

const initial = {
  stage: 'request' as Stage,
  busy: null,
  error: null,
  log: [],
  request: '',
  intentGraphs: [],
  concepts: [],
  concept: '',
  designGraph: null,
  buildOptions: [],
  buildInstruction: '',
  scopeGraph: null,
  dataSpec: null,
  plan: '',
  componentGraphs: [],
  codeVersions: [],
  currentCodeIndex: -1,
  runErrors: [],
  testCases: [],
  testResults: [],
  critique: '',
  highlightNodes: [],
  highlightReason: '',
};

export const latest = <T,>(xs: Versioned<T>[]) => xs[xs.length - 1]?.value;
export const nextVersionId = (base: string, xs: { id: string }[]) => `${base}_${xs.length + 1}`;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...initial,

      async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
        set({ busy: label, error: null });
        try {
          const r = await fn();
          set((s) => ({ log: [...s.log, { at: Date.now(), step: label }] }));
          return r;
        } catch (e) {
          set({ error: `${label}: ${(e as Error).message}` });
          throw e;
        } finally {
          set({ busy: null });
        }
      },

      setRequest: (request) => set({ request }),

      // Process 1: r1 -> [model translate]~ -> r2
      async startDesign() {
        const { request, run } = get();
        if (!request.trim()) return;
        set({ ...initial, request, stage: 'request' });
        const g = await run('model translate: request → intent graph (r2)', () => op<Graph>('intentGraph', { request }));
        set({ intentGraphs: [{ id: 'r2_1', value: g }], stage: 'intent' });
      },

      // Process 2: r2_1 -> [human modify] -> r2_2
      modifyIntentGraph(g) {
        set((s) => ({ intentGraphs: [...s.intentGraphs, { id: nextVersionId('r2', s.intentGraphs), value: g }] }));
      },

      // r2 -> [model generate]~ -> r2 + r3*
      async generateConcepts() {
        const intentGraph = latest(get().intentGraphs)!;
        const concepts = await get().run('model generate: design concepts (r3*)', () => op<string[]>('concepts', { intentGraph }));
        set({ concepts, stage: 'concepts' });
      },

      // [human select] r4, then r2 + r4 -> [model translate]~ -> r5 -> [model generate]~ -> r6*
      async selectConcept(concept) {
        const { run } = get();
        const intentGraph = latest(get().intentGraphs)!;
        set({ concept, designGraph: null, buildOptions: [] });
        const designGraph = await run('model translate: concept → design graph (r5)', () => op<Graph>('designGraph', { intentGraph, concept }));
        set({ designGraph });
        await get().regenerateBuildOptions();
      },

      async regenerateBuildOptions() {
        const designGraph = get().designGraph!;
        const buildOptions = await get().run('model generate: build instructions (r6*)', () => op<string[]>('buildOptions', { designGraph }));
        set({ buildOptions, stage: 'build' });
      },

      // [human select] r7, then r8 … r12_1, then process 3
      async selectBuildInstruction(buildInstruction) {
        const { run } = get();
        const designGraph = get().designGraph!;
        set({ buildInstruction, stage: 'generating', scopeGraph: null, dataSpec: null, plan: '', componentGraphs: [], codeVersions: [], currentCodeIndex: -1, testCases: [], testResults: [], critique: '', runErrors: [] });
        try {
          const scopeGraph = await run('model select: scope subgraph (r8)', () => op<Graph>('selectScope', { designGraph, buildInstruction }));
          set({ scopeGraph });
          const dataSpec = await run('model extract: data spec (r9)', () => op<DataSpec>('dataSpec', { scopeGraph, buildInstruction }));
          set({ dataSpec });
          const plan = await run('model generate: implementation plan (r10)', () => op<string>('plan', { scopeGraph, buildInstruction, dataSpec }));
          set({ plan });
          const componentGraph = await run('model generate: component graph (r11)', () => op<Graph>('componentGraph', { scopeGraph, buildInstruction, plan }));
          set({ componentGraphs: [{ id: 'r11_1', value: componentGraph }] });
          const code = await run('model translate: component graph → code (r12_1)', () => op<string>('code', { componentGraph, buildInstruction }));
          get().addCode('r12_1', 'first translation', code);
        } catch {
          return;
        }
        await get().runProcess3();
      },

      // Process 3: test, repair, generate tests, evaluate, revise, render.
      async runProcess3() {
        const { run } = get();
        const componentGraph = latest(get().componentGraphs)!;
        const buildInstruction = get().buildInstruction;
        set({ stage: 'testing' });
        try {
          const code1 = get().codeVersions[get().codeVersions.length - 1].code;
          const runErrors = await run('tool_2 execute: run program (r13*)', () => executeForErrors(code1));
          set({ runErrors });
          const code2 = await run('model modify: repair (r12_2)', () => op<string>('repair', { code: code1, componentGraph, buildInstruction, errors: runErrors }));
          get().addCode('r12_2', 'repaired after execution', code2);
          const testCases = await run('model generate: test cases (r14*)', () => op<TestCase[]>('testCases', { code: code2, componentGraph, buildInstruction }));
          set({ testCases });
          const testResults = await run('tool_2 execute: run tests (r15*, r16*)', () => executeTests(code2, testCases));
          set({ testResults });
          const critique = await run('model evaluate: critique test results (r17)', () =>
            op<string>('evaluateTests', { code: code2, componentGraph, buildInstruction, testCases, results: testResults }),
          );
          set({ critique });
          const code3 = await run('model modify: revise from critique (r12_3)', () => op<string>('revise', { code: code2, componentGraph, testCases, critique }));
          get().addCode('r12_3', 'revised after test critique', code3);
          // tool_1 execute → r18: the main VisualView renders the current code.
          set({ stage: 'done' });
        } catch {
          set({ stage: 'done' });
        }
      },

      addCode(id, label, code) {
        set((s) => {
          const codeVersions = [...s.codeVersions, { id, label, code, createdAt: Date.now() }];
          return { codeVersions, currentCodeIndex: codeVersions.length - 1 };
        });
      },
      setCurrentCode: (i) => set({ currentCodeIndex: i }),
      addComponentGraph(g) {
        const id = nextVersionId('r11', get().componentGraphs);
        set((s) => ({ componentGraphs: [...s.componentGraphs, { id, value: g }] }));
        return id;
      },
      setHighlight: (ids, reason = '') => set({ highlightNodes: ids, highlightReason: reason }),
      reset: () => set({ ...initial }),
    }),
    {
      name: 'system-x-session',
      partialize: (s) => {
        const { busy, error, run, ...rest } = s as any;
        return rest;
      },
      onRehydrateStorage: () => (s) => {
        // an interrupted pipeline cannot resume mid-call
        if (s && (s.stage === 'generating' || s.stage === 'testing')) s.stage = s.codeVersions.length ? 'done' : 'build';
      },
    },
  ),
);

export const useCurrentCode = () =>
  useStore((s) => (s.currentCodeIndex >= 0 ? s.codeVersions[s.currentCodeIndex] : undefined));
export const useComponentGraph = () => useStore((s) => s.componentGraphs[s.componentGraphs.length - 1]);
