// One prompt per model operation in the design. Each op receives only the representations
// present in the state that precedes it (see PLAN.md), and its output is validated.
import type { DataSpec, Graph, GraphEdit, Param, Region, Stroke, TestCase, TestResult } from '../src/shared/types';
import { CANVAS, ISSUE_CATEGORIES, VERDICTS } from '../src/shared/types';
import {
  subgraph,
  validateCategory,
  validateCode,
  validateDataSpec,
  validateGraph,
  validateGraphEdit,
  validateParams,
  validateTextList,
} from '../src/shared/validate';

export const SYSTEM = `You are one step inside a tool that helps people build data-driven SVG visualization programs.
Answer only with the JSON object required by the output schema. Be concrete and concise.`;

const CODE_CONTRACT = `Program contract (must hold for every version of the code):
- Plain browser JavaScript, no imports, no libraries, no network access.
- Define \`const SAMPLE_DATA = [...]\` (realistic default data, an array of objects).
- Define \`function render(svg, data)\` that draws into the given <svg> element (width ${CANVAS.width}, height ${CANVAS.height}, viewBox "0 0 ${CANVAS.width} ${CANVAS.height}") using document.createElementNS('http://www.w3.org/2000/svg', ...).
- render must first clear the svg, must not throw on empty arrays, missing fields or odd values, and may attach event listeners for interaction (hover, click).
- Give each major part a group <g data-component="<component id>"> so parts can be traced back to the component graph.`;

// ---------- JSON schemas ----------
const nodeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    kind: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['id', 'label', 'kind', 'description'],
};
const edgeSchema = {
  type: 'object',
  properties: { source: { type: 'string' }, target: { type: 'string' }, label: { type: 'string' } },
  required: ['source', 'target'],
};
const graphSchema = {
  type: 'object',
  properties: { nodes: { type: 'array', items: nodeSchema }, edges: { type: 'array', items: edgeSchema } },
  required: ['nodes', 'edges'],
};
const codeSchema = { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] };
const listSchema = { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] };
const categorySchema = {
  type: 'object',
  properties: { category: { type: 'string', enum: [...ISSUE_CATEGORIES] }, reason: { type: 'string' } },
  required: ['category', 'reason'],
};
const graphEditSchema = {
  type: 'object',
  properties: {
    addNodes: { type: 'array', items: nodeSchema },
    updateNodes: { type: 'array', items: nodeSchema },
    removeNodeIds: { type: 'array', items: { type: 'string' } },
    addEdges: { type: 'array', items: edgeSchema },
    removeEdges: { type: 'array', items: edgeSchema },
  },
  required: ['addNodes', 'updateNodes', 'removeNodeIds', 'addEdges', 'removeEdges'],
};

// ---------- helpers ----------
const j = (v: unknown) => JSON.stringify(v, null, 1);
const graphText = (g: Graph) => j(g);
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `… [${s.length - n} more chars]` : s);
const regionText = (r: Region) =>
  `x=${Math.round(r.x)}, y=${Math.round(r.y)}, width=${Math.round(r.width)}, height=${Math.round(r.height)} (SVG units on the ${CANVAS.width}x${CANVAS.height} canvas, origin top-left)`;
const codeBlock = (code: string) => '```js\n' + code + '\n```';

export interface Op {
  schema: object;
  prompt: (input: any) => string;
  post: (out: any, input: any) => unknown;
}

export const OPS: Record<string, Op> = {
  // ===== Process 1 =====
  // r1 -> [model translate]~ -> r2
  intentGraph: {
    schema: graphSchema,
    prompt: ({ request }: { request: string }) => `Translate the user's request into an INTENT GRAPH.
Nodes are the intents expressed or implied by the request; kind is one of goal, data, encoding, interaction, style, audience.
Exactly one node of kind "goal"; link it to the other nodes (edge label = relation). 5-10 nodes. Use short snake_case ids.

User request:
"""${request}"""`,
    post: (out) => validateGraph(out, 'intent graph', 3),
  },
  // r2 -> [model generate]~ -> r2 + r3*
  concepts: {
    schema: listSchema,
    prompt: ({ intentGraph }: { intentGraph: Graph }) => `Here is an intent graph for a visualization:
${graphText(intentGraph)}

Generate 4 clearly different DESIGN CONCEPTS that satisfy this intent (different chart forms, layouts or interaction ideas).
Each concept is 2-3 sentences of prose starting with a short title followed by a colon. Return them as "items".`,
    post: (out) => validateTextList(out.items, 'concepts', 2, 5),
  },
  // r2 + r4 -> [model translate]~ -> r5
  designGraph: {
    schema: graphSchema,
    prompt: ({ intentGraph, concept }: { intentGraph: Graph; concept: string }) => `Translate the chosen concept into a DESIGN GRAPH: a detailed requirement graph for the visualization.
Nodes are concrete design requirements; kind is one of data, transform, mark, encoding, scale, axis, legend, annotation, interaction, layout, style.
Edges express dependencies (source is needed by target). 8-16 nodes. Keep the intents of the intent graph. Use short snake_case ids.

Intent graph:
${graphText(intentGraph)}

Chosen concept (instruction):
"""${concept}"""`,
    post: (out) => validateGraph(out, 'design graph', 3),
  },
  // r5 -> [model generate]~ -> r5 + r6*
  buildOptions: {
    schema: listSchema,
    prompt: ({ designGraph }: { designGraph: Graph }) => `Design graph:
${graphText(designGraph)}

Generate 3-4 alternative BUILD INSTRUCTIONS for the first version of the program. Each is one or two sentences telling a programmer what to build now, e.g. a minimal core, the full static chart, or the chart with its main interaction. Order them from smallest to most complete. Return them as "items".`,
    post: (out) => validateTextList(out.items, 'build instructions', 2, 5),
  },
  // r5 + r7 -> [model select] -> r8 (+ r7)
  selectScope: {
    schema: { type: 'object', properties: { nodeIds: { type: 'array', items: { type: 'string' } } }, required: ['nodeIds'] },
    prompt: ({ designGraph, buildInstruction }: { designGraph: Graph; buildInstruction: string }) => `Select the nodes of the design graph that must be implemented to follow the build instruction. Return their ids as "nodeIds" (only ids that exist).

Design graph:
${graphText(designGraph)}

Build instruction:
"""${buildInstruction}"""`,
    post: (out, input) => subgraph(input.designGraph, out.nodeIds),
  },
  // r8 + r7 -> [model extract] -> r9
  dataSpec: {
    schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, type: { type: 'string', enum: ['number', 'string', 'date', 'boolean'] }, description: { type: 'string' } },
            required: ['name', 'type', 'description'],
          },
        },
        sample: { type: 'array', items: { type: 'object' } },
      },
      required: ['fields', 'sample'],
    },
    prompt: ({ scopeGraph, buildInstruction }: { scopeGraph: Graph; buildInstruction: string }) => `Extract the DATA SPECIFICATION the visualization needs: the fields of one data row (name, type, description) and 6-15 realistic sample rows (dates as ISO strings).

Scoped design graph:
${graphText(scopeGraph)}

Build instruction:
"""${buildInstruction}"""`,
    post: (out) => validateDataSpec(out as DataSpec),
  },
  // r8 + r7 + r9 -> [model generate]~ -> r10
  plan: {
    schema: { type: 'object', properties: { plan: { type: 'string' } }, required: ['plan'] },
    prompt: ({ scopeGraph, buildInstruction, dataSpec }: { scopeGraph: Graph; buildInstruction: string; dataSpec: DataSpec }) => `Write an IMPLEMENTATION PLAN (prose, numbered steps, under 250 words) for a program that follows the build instruction. Mention the data fields by name and include the sample data shape, the scales, marks, layout and any interaction. The drawing area is fixed at ${CANVAS.width}x${CANVAS.height} SVG units; plain JavaScript only, no libraries.

Scoped design graph:
${graphText(scopeGraph)}

Data specification:
${j(dataSpec)}

Build instruction:
"""${buildInstruction}"""`,
    post: (out) => {
      if (!String(out.plan ?? '').trim()) throw new Error('empty plan');
      return String(out.plan).trim();
    },
  },
  // r8 + r7 + r10 -> [model generate]~ -> r11 (+ r7)
  componentGraph: {
    schema: graphSchema,
    prompt: ({ scopeGraph, buildInstruction, plan }: { scopeGraph: Graph; buildInstruction: string; plan: string }) => `Generate the COMPONENT GRAPH of the program: nodes are program components (kind one of data, scale, axis, mark, legend, label, layout, interaction, style), edges are data flow between them. Each description states exactly what the component does and which data fields it uses (include field names and sample-data shape in the data node's description). 5-12 nodes, short snake_case ids.

Scoped design graph:
${graphText(scopeGraph)}

Implementation plan:
"""${plan}"""

Build instruction:
"""${buildInstruction}"""`,
    post: (out) => validateGraph(out, 'component graph', 2),
  },
  // r11 + r7 -> [model translate]~ -> r12_1
  code: {
    schema: codeSchema,
    prompt: ({ componentGraph, buildInstruction }: { componentGraph: Graph; buildInstruction: string }) => `Translate the component graph into a working program.
${CODE_CONTRACT}

Component graph (use the node ids for data-component attributes):
${graphText(componentGraph)}

Build instruction:
"""${buildInstruction}"""

Return the whole program as "code".`,
    post: (out) => validateCode(out.code),
  },

  // ===== Process 3 =====
  // r12_1 + r11 + r7 + r13* -> [model modify]~ -> r12_2
  repair: {
    schema: codeSchema,
    prompt: ({ code, componentGraph, buildInstruction, errors }: { code: string; componentGraph: Graph; buildInstruction: string; errors: string[] }) => `The program was executed with its SAMPLE_DATA. Modify it to fix every reported problem. If there are no errors, return it with only robustness fixes (empty data, missing fields). Keep everything else.
${CODE_CONTRACT}

Execution errors:
${errors.length ? errors.map((e) => '- ' + e).join('\n') : '(none)'}

Component graph:
${graphText(componentGraph)}

Build instruction:
"""${buildInstruction}"""

Program:
${codeBlock(code)}
Return the whole modified program as "code".`,
    post: (out) => validateCode(out.code),
  },
  // r12_2 + r11 + r7 -> [model generate]~ -> r14*
  testCases: {
    schema: {
      type: 'object',
      properties: {
        tests: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, description: { type: 'string' }, expectation: { type: 'string' }, dataJson: { type: 'string' } },
            required: ['name', 'description', 'expectation', 'dataJson'],
          },
        },
      },
      required: ['tests'],
    },
    prompt: ({ code, componentGraph, buildInstruction }: { code: string; componentGraph: Graph; buildInstruction: string }) => `Generate 5 TEST CASES (input data for render) that probe this program: typical data, many rows, a single row, empty array, extreme / negative / missing values, long labels. dataJson is the JSON-encoded data array passed as the second argument to render. expectation says what a correct rendering shows.

Component graph:
${graphText(componentGraph)}

Build instruction:
"""${buildInstruction}"""

Program:
${codeBlock(code)}`,
    post: (out): TestCase[] => {
      const tests = (out.tests ?? []).map((t: any, i: number) => {
        let data: unknown;
        try {
          data = JSON.parse(t.dataJson);
        } catch {
          throw new Error(`test ${i + 1}: dataJson is not valid JSON`);
        }
        return { id: `t${i + 1}`, name: t.name, description: t.description, expectation: t.expectation, data };
      });
      if (tests.length < 2) throw new Error('need at least 2 tests');
      return tests;
    },
  },
  // r12_2 + r11 + r7 + r14* + r15* + r16* -> [model evaluate]~ -> r17
  evaluateTests: {
    schema: { type: 'object', properties: { critique: { type: 'string' } }, required: ['critique'] },
    prompt: ({ code, componentGraph, buildInstruction, testCases, results }: { code: string; componentGraph: Graph; buildInstruction: string; testCases: TestCase[]; results: TestResult[] }) => `Evaluate the test results of the program. For each test compare the execution record and SVG snapshot against the expectation. Write a CRITIQUE: a bullet list of concrete problems (which test, what is wrong, what to change), most important first, then one line on what already works. Under 250 words.

Build instruction:
"""${buildInstruction}"""

Component graph:
${graphText(componentGraph)}

Program:
${codeBlock(code)}

Tests and results:
${testCases
  .map((t) => {
    const r = results.find((x) => x.testId === t.id);
    return `## ${t.id} ${t.name}
expectation: ${t.expectation}
data: ${truncate(JSON.stringify(t.data), 600)}
status: ${r?.status} errors: ${j(r?.errors ?? [])}
element counts: ${j(r?.stats ?? {})}
svg snapshot: ${truncate(r?.svg ?? '', 2500)}`;
  })
  .join('\n\n')}`,
    post: (out) => String(out.critique ?? '').trim() || 'No problems found.',
  },
  // r12_2 + r11 + r14* + r17 -> [model modify]~ -> r12_3
  revise: {
    schema: codeSchema,
    prompt: ({ code, componentGraph, testCases, critique }: { code: string; componentGraph: Graph; testCases: TestCase[]; critique: string }) => `Modify the program to address the critique so that it handles all test cases. Keep what works.
${CODE_CONTRACT}

Critique:
"""${critique}"""

Test cases:
${testCases.map((t) => `- ${t.name}: ${t.expectation} (data: ${truncate(JSON.stringify(t.data), 300)})`).join('\n')}

Component graph:
${graphText(componentGraph)}

Program:
${codeBlock(code)}
Return the whole modified program as "code".`,
    post: (out) => validateCode(out.code),
  },

  // ===== Process 4 =====
  // r21 (+ the test it judges) + r12_3 -> [model select] -> r22
  issueCategory: {
    schema: categorySchema,
    prompt: ({ verdict, testCase, code }: { verdict: string; testCase: TestCase; code: string }) => `A person reviewed the rendering of a test case and gave the verdict "${verdict}" (one of ${VERDICTS.join(', ')}).
Select the ISSUE CATEGORY most likely responsible, from: ${ISSUE_CATEGORIES.join(', ')}.

Test case judged: ${testCase.name} — expectation: ${testCase.expectation}
data: ${truncate(JSON.stringify(testCase.data), 800)}

Program:
${codeBlock(code)}`,
    post: (out) => ({ category: validateCategory(out.category), reason: String(out.reason ?? '') }),
  },
  // r22 + r21 + r12_3 -> [model generate]~ -> r23
  fixOptions: {
    schema: {
      type: 'object',
      properties: {
        diagnosis: { type: 'string' },
        options: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, instruction: { type: 'string' } }, required: ['title', 'instruction'] } },
      },
      required: ['diagnosis', 'options'],
    },
    prompt: ({ category, verdict, testCase, code }: { category: string; verdict: string; testCase: TestCase; code: string }) => `A person judged a rendering as "${verdict}"; the issue category is "${category}". Diagnose the cause in the code (2-3 sentences) and propose 3 alternative FIX OPTIONS (short title + precise instruction for a programmer).

Test case judged: ${testCase.name} — expectation: ${testCase.expectation}
data: ${truncate(JSON.stringify(testCase.data), 800)}

Program:
${codeBlock(code)}`,
    post: (out) => {
      if (!Array.isArray(out.options) || !out.options.length) throw new Error('need at least one option');
      return { diagnosis: String(out.diagnosis), options: out.options.slice(0, 4) };
    },
  },
  // r24 + r12_3 -> [model modify]~ -> r25_4
  applyFix: {
    schema: codeSchema,
    prompt: ({ fix, code }: { fix: { title: string; instruction: string }; code: string }) => `Modify the program by applying this fix. Change nothing else.
${CODE_CONTRACT}

Fix: ${fix.title}
${fix.instruction}

Program:
${codeBlock(code)}
Return the whole modified program as "code".`,
    post: (out) => validateCode(out.code),
  },

  // ===== Process 5 =====
  // r26 + r27 + r11 + r12_3 -> [model select] -> r22_2
  regionCategory: {
    schema: categorySchema,
    prompt: ({ region, request, componentGraph, code }: { region: Region; request: string; componentGraph: Graph; code: string }) => `A person selected a region of the rendered visualization and asked for a change. Select the ISSUE CATEGORY of the change, from: ${ISSUE_CATEGORIES.join(', ')}.

Region: ${regionText(region)}
Request: """${request}"""

Component graph:
${graphText(componentGraph)}

Program:
${codeBlock(code)}`,
    post: (out) => ({ category: validateCategory(out.category), reason: String(out.reason ?? '') }),
  },
  // r22_2 + r27 + r11 + r12_3 -> [model generate]~ -> r28
  graphEditOptions: {
    schema: {
      type: 'object',
      properties: { options: { type: 'array', items: { type: 'object', properties: { summary: { type: 'string' }, edit: graphEditSchema }, required: ['summary', 'edit'] } } },
      required: ['options'],
    },
    prompt: ({ category, request, componentGraph, code }: { category: string; request: string; componentGraph: Graph; code: string }) => `Propose 2-3 alternative ways to realize the request as EDITS TO THE COMPONENT GRAPH (category: ${category}).
An edit may add nodes, update nodes (same id, new label/description), remove nodes by id, add edges and remove edges. Node descriptions must say precisely what the component should do after the change, so that a programmer can update the code from the graph alone.

Request: """${request}"""

Component graph:
${graphText(componentGraph)}

Program (for reference):
${codeBlock(code)}`,
    post: (out, input) => {
      const opts = (out.options ?? []).map((o: any) => ({ summary: String(o.summary), edit: validateGraphEdit(o.edit as GraphEdit, input.componentGraph) }));
      if (!opts.length) throw new Error('need at least one option');
      return opts;
    },
  },
  // r11_2 + r12_3 -> [model modify]~ -> r30_4
  codeFromGraph: {
    schema: codeSchema,
    prompt: ({ componentGraph, code }: { componentGraph: Graph; code: string }) => `The component graph has been updated. Modify the program so that it implements the graph exactly: add, change or remove the corresponding parts. Keep parts whose nodes did not change.
${CODE_CONTRACT}

Updated component graph:
${graphText(componentGraph)}

Program:
${codeBlock(code)}
Return the whole modified program as "code".`,
    post: (out) => validateCode(out.code),
  },

  // ===== Process 6 =====
  // r31 + r11 + r12_3 -> [model extract] -> r32
  extractParams: {
    schema: {
      type: 'object',
      properties: {
        params: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['number', 'color', 'string', 'boolean'] }, value: { type: 'string' }, description: { type: 'string' } },
            required: ['name', 'kind', 'value', 'description'],
          },
        },
      },
      required: ['params'],
    },
    prompt: ({ nodeId, componentGraph, code }: { nodeId: string; componentGraph: Graph; code: string }) => `Extract the adjustable PARAMETERS of the component "${nodeId}" from the program: the literal values in its code that a person might want to tune (sizes, paddings, colors as hex, tick counts, font sizes, label texts, opacity, flags). 3-10 parameters with their current values as strings and kind number/color/string/boolean.

Component graph:
${graphText(componentGraph)}

Program:
${codeBlock(code)}`,
    post: (out) => validateParams(out.params as Param[]),
  },
  // r32_2 + r12_3 -> [model modify]~ -> r33_4
  applyParams: {
    schema: codeSchema,
    prompt: ({ params, code }: { params: (Param & { original: string })[]; code: string }) => `Modify the program so that these parameters take their new values. Change nothing else.
${CODE_CONTRACT}

Parameters (original -> new):
${params.map((p) => `- ${p.name} (${p.kind}): ${p.original} -> ${p.value}   // ${p.description}`).join('\n')}

Program:
${codeBlock(code)}
Return the whole modified program as "code".`,
    post: (out) => validateCode(out.code),
  },

  // ===== Process 7 =====
  // r34 + r35 + r12_3 -> [model translate]~ -> r36
  sketchToCode: {
    schema: { type: 'object', properties: { description: { type: 'string' }, fragment: { type: 'string' } }, required: ['description', 'fragment'] },
    prompt: ({ region, strokes, code }: { region: Region; strokes: Stroke[]; code: string }) => `A person drew a freehand SKETCH inside a selected region of the rendered visualization. Interpret what the sketch depicts (e.g. an arrow, a circle around something, a line, a new mark, an annotation, text-like scribble) and translate it into a JavaScript CODE FRAGMENT that draws that element with SVG inside render(svg, data). Prefer computing positions from the data/scales in the program when the sketch clearly refers to data; otherwise use the sketched coordinates. Wrap it in <g data-component="sketch_annotation">.

Region: ${regionText(region)}
Sketch strokes (polylines in SVG units, each x,y point):
${strokes.map((s, i) => `stroke ${i + 1}: ${s.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ')}`).join('\n')}

Program:
${codeBlock(code)}
Return "description" (one sentence: what you think the sketch is) and "fragment" (the code).`,
    post: (out) => {
      if (!String(out.fragment ?? '').trim()) throw new Error('empty fragment');
      return { description: String(out.description), fragment: String(out.fragment) };
    },
  },
  // r36 + r34 + r12_3 -> [model modify]~ -> r37_4
  mergeFragment: {
    schema: codeSchema,
    prompt: ({ fragment, region, code }: { fragment: string; region: Region; code: string }) => `Integrate the code fragment into the program's render function so the sketched element is drawn in the selected region. Adapt variable names to the program. Change nothing else.
${CODE_CONTRACT}

Region: ${regionText(region)}
Fragment:
${codeBlock(fragment)}

Program:
${codeBlock(code)}
Return the whole modified program as "code".`,
    post: (out) => validateCode(out.code),
  },

  // ===== Process 8 =====
  // r39 + r11 + r12_3 -> [model match] -> r40
  matchRegion: {
    schema: { type: 'object', properties: { nodeIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['nodeIds', 'reason'] },
    prompt: ({ region, componentGraph, code }: { region: Region; componentGraph: Graph; code: string }) => `A person selected a region of the rendered visualization. Using the program's layout logic (margins, scales, positions) determine which components of the component graph draw something inside that region. Return their ids as "nodeIds" (only ids from the graph) and a one-sentence reason.

Region: ${regionText(region)}

Component graph:
${graphText(componentGraph)}

Program:
${codeBlock(code)}`,
    post: (out, input) => {
      const sub = subgraph(input.componentGraph, out.nodeIds);
      return { nodeIds: sub.nodes.map((n) => n.id), reason: String(out.reason ?? '') };
    },
  },
};
