// Application state. Field names follow the design's identifiers (without versions).
import type { ChartSpec, Concept, DerivationRequest, Row, Table, Value } from '../shared/types';
import { assignConcepts, extractConcepts } from '../shared/concepts';

/** One table version with the concepts extracted from it (table_n + concepts_n). */
export interface TableVersion {
  table: Table;
  concepts: Concept[];
}

export interface SavedChart {
  id: string;
  spec: ChartSpec;
  tableVersion: number;
}

export interface AppState {
  /** every version of table/concepts, oldest first */
  versions: TableVersion[];
  current: number; // index into versions
  /** custom_concepts*: named by the user, not yet in the table */
  customConcepts: Concept[];
  /** chart_spec */
  chartSpec: ChartSpec;
  savedCharts: SavedChart[];
}

export const initialState: AppState = {
  versions: [],
  current: -1,
  customConcepts: [],
  chartSpec: { mark: 'point', encodings: {} },
  savedCharts: [],
};

export type Action =
  | { type: 'LOAD_TABLE'; name: string; columns: string[]; rows: Row[] }
  | { type: 'SELECT_VERSION'; index: number }
  | { type: 'SET_SPEC'; spec: ChartSpec }
  | { type: 'ADD_CUSTOM'; concept: Concept }
  | { type: 'REMOVE_CUSTOM'; name: string }
  | { type: 'ACCEPT_RESHAPE'; columns: string[]; rows: Row[]; origin: string }
  | { type: 'APPLY_DERIVATION'; request: DerivationRequest; code: string; values: Value[]; refine: boolean }
  | { type: 'SAVE_CHART' }
  | { type: 'DELETE_CHART'; id: string };

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export function currentVersion(s: AppState): TableVersion | undefined {
  return s.versions[s.current];
}

/** All concepts available for charts: concepts of the current table + pending custom concepts. */
export function allConcepts(s: AppState): Concept[] {
  const v = currentVersion(s);
  const cols = v?.table.columns ?? [];
  return [...(v?.concepts ?? []), ...s.customConcepts.filter((c) => !cols.includes(c.name))];
}

function pushVersion(s: AppState, table: Omit<Table, 'id' | 'version'>, concepts: (t: Table) => Concept[]): AppState {
  const t: Table = { ...table, id: uid(), version: s.versions.length + 1 };
  const versions = [...s.versions, { table: t, concepts: concepts(t) }];
  return { ...s, versions, current: versions.length - 1 };
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'LOAD_TABLE': {
      // table_1 -> [tool_1 extract] -> concepts_1
      const fresh = { ...initialState, chartSpec: { mark: 'point' as const, encodings: {} } };
      return pushVersion(fresh, { name: a.name, columns: a.columns, rows: a.rows, origin: 'loaded' }, (t) => extractConcepts(t));
    }
    case 'SELECT_VERSION':
      return { ...s, current: a.index };
    case 'SET_SPEC':
      return { ...s, chartSpec: a.spec };
    case 'ADD_CUSTOM':
      return { ...s, customConcepts: [...s.customConcepts.filter((c) => c.name !== a.concept.name), a.concept] };
    case 'REMOVE_CUSTOM':
      return {
        ...s,
        customConcepts: s.customConcepts.filter((c) => c.name !== a.name),
        chartSpec: {
          ...s.chartSpec,
          encodings: Object.fromEntries(Object.entries(s.chartSpec.encodings).filter(([, f]) => f !== a.name)),
        },
      };
    case 'ACCEPT_RESHAPE': {
      // human select -> table_2; [tool_1 assign] -> concepts_2
      const v = currentVersion(s)!;
      const prev = [...v.concepts, ...s.customConcepts];
      const next = pushVersion(
        s,
        { name: v.table.name, columns: a.columns, rows: a.rows, origin: a.origin },
        (t) => assignConcepts(t, prev).filter((c) => c.source !== 'custom'),
      );
      return { ...next, customConcepts: s.customConcepts.filter((c) => !a.columns.includes(c.name)) };
    }
    case 'APPLY_DERIVATION': {
      // selected_code -> [tool_1 execute] -> table_{n+1} + concepts_{n+1}
      const v = currentVersion(s)!;
      const name = a.request.name;
      const columns = v.table.columns.includes(name) ? v.table.columns : [...v.table.columns, name];
      const rows = v.table.rows.map((r, i) => ({ ...r, [name]: a.values[i] ?? null }));
      const old = v.concepts.find((c) => c.name === name);
      const requests = a.refine && old?.derivation ? [...old.derivation.requests, a.request] : [a.request];
      const origin = a.refine ? `refined "${name}"` : `derived "${name}"`;
      return pushVersion(s, { name: v.table.name, columns, rows, origin }, (t) =>
        extractConcepts(t, v.concepts).map((c) =>
          c.name === name ? { ...c, source: 'derived' as const, derivation: { requests, code: a.code } } : c,
        ),
      );
    }
    case 'SAVE_CHART': {
      const v = currentVersion(s);
      if (!v) return s;
      return { ...s, savedCharts: [...s.savedCharts, { id: uid(), spec: s.chartSpec, tableVersion: s.current }] };
    }
    case 'DELETE_CHART':
      return { ...s, savedCharts: s.savedCharts.filter((c) => c.id !== a.id) };
  }
}
