// model_4: language model with tool calling (process 10).
// Tool calling is realized by giving the tool list in the prompt and asking for a JSON-schema'd call.
import { callModel } from '../llm.js';
import type { ConstraintIssue, ConstraintReport, FixCall, Workspace } from '../../shared/types.js';
import { FIX_TOOLS } from '../tools/geometryFixes.js';

const SYSTEM =
  'You are the fabrication assistant (model_4) of a layered laser-cut design tool. You explain geometric fabrication problems ' +
  'in plain, friendly language for makers and you operate geometry tools to fix them. Answer only with the requested JSON.';

function context(ws: Workspace, issues: ConstraintIssue[]) {
  return JSON.stringify(
    {
      material: ws.material,
      layers: ws.canvas!.layers.map((l) => ({
        layerId: l.id,
        name: l.name,
        depth: l.depth,
        frame: l.frame,
        elements: l.elementIds.map((id) => ({ elementId: id, name: ws.elements[id]?.name, origin: ws.elements[id]?.origin })),
      })),
      issues: issues.map((i) => ({ ...i, box: i.box.map(Math.round), from: i.from?.map(Math.round), to: i.to?.map(Math.round), areaMm2: +i.areaMm2.toFixed(1) })),
    },
    null,
    1,
  );
}

/** [model_4 generate]~  canvas + material_settings + constraint_issues → constraint_report */
export async function explainIssues(ws: Workspace, issues: ConstraintIssue[]): Promise<ConstraintReport> {
  if (!issues.length) return { report: 'No fabrication problems found. The design is ready to export.', options: [] };
  const r = await callModel<ConstraintReport>({
    role: 'model_4',
    system: SYSTEM,
    schema: {
      type: 'object',
      properties: {
        report: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              description: { type: 'string' },
              issueIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'label', 'description', 'issueIds'],
          },
        },
      },
      required: ['report', 'options'],
    },
    prompt:
      `Design state and detected problems:\n${context(ws, issues)}\n\nAvailable geometry tools:\n${FIX_TOOLS.map((t) => `- ${t.tool}: ${t.description}`).join('\n')}\n\n` +
      `Write "report": a short explanation (3-6 sentences) of what is wrong, why it matters for cutting ${ws.material.material}, and what the trade-offs of fixing are.\n` +
      `Then offer 2-6 concrete remedies in "options" (ids "opt1", "opt2", …), each feasible with the tools above, naming the affected elements/layers, and listing the issueIds it addresses. ` +
      `Prefer remedies that keep the artwork's look (bridges, frames) over deleting things. Include an option that addresses all issues at once if sensible.`,
  });
  const valid = new Set(issues.map((i) => i.id));
  return {
    report: r.report,
    options: (r.options ?? []).slice(0, 6).map((o, k) => ({ ...o, id: o.id || `opt${k + 1}`, issueIds: (o.issueIds ?? []).filter((i) => valid.has(i)) })),
  };
}

/** [model_4 translate]  canvas + material_settings + resolution → fix_call(s) */
export async function toFixCalls(ws: Workspace, issues: ConstraintIssue[], resolution: string): Promise<{ calls: FixCall[]; message: string }> {
  const r = await callModel<{ calls: { tool: string; args: Record<string, unknown> }[]; message: string }>({
    role: 'model_4',
    system: SYSTEM,
    schema: {
      type: 'object',
      properties: {
        calls: {
          type: 'array',
          items: {
            type: 'object',
            properties: { tool: { type: 'string', enum: FIX_TOOLS.map((t) => t.tool) }, args: { type: 'object' } },
            required: ['tool', 'args'],
          },
        },
        message: { type: 'string' },
      },
      required: ['calls', 'message'],
    },
    prompt:
      `Design state and detected problems:\n${context(ws, issues)}\n\nTools (name: args):\n${FIX_TOOLS.map((t) => `- ${t.tool}: ${t.description} Args: ${t.args}`).join('\n')}\n\n` +
      `The user chose this resolution: "${resolution}"\n` +
      `Translate it into the tool calls that apply it, using exact layerId/elementId values and the issues' from/to points for bridges. ` +
      `Return an empty list if the user does not want changes. "message" says in one sentence what you will do.`,
  });
  const allowed = new Set(FIX_TOOLS.map((t) => t.tool));
  return { calls: (r.calls ?? []).filter((c) => allowed.has(c.tool)).slice(0, 20), message: r.message };
}
