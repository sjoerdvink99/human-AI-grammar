// model_7 evaluate: vision-language model judges, from the top-down view, whether each
// retrieved affordance is realized in the final scene.
import { z } from 'zod';
import type { RealizationSignal } from '../shared/types';
import { callModel } from './llm';

const SIGNALS = ['realized', 'partial', 'not_realized'] as const;
const Schema = z.object({
  signals: z.array(z.object({ id: z.string(), signal: z.enum(SIGNALS), reason: z.string() })),
});
const jsonSchema = {
  type: 'object',
  properties: {
    signals: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, signal: { type: 'string', enum: [...SIGNALS] }, reason: { type: 'string' } },
        required: ['id', 'signal', 'reason'],
      },
    },
  },
  required: ['signals'],
};

export interface SignalRow { affordanceId: string; statement: string; signal: RealizationSignal; reason: string }

export async function evaluateRealization(
  imagePath: string, legend: string, affordances: { id: string; statement: string }[],
): Promise<SignalRow[]> {
  if (!affordances.length) return [];
  const out = await callModel({
    role: 'model_7 evaluate',
    system: 'You are a vision-language judge of interior layouts. Base your judgement on the image. Answer only with the requested JSON.',
    prompt: `The image is a top-down view of a finished room layout (north at the top). Each object is drawn as a labelled rectangle with a small triangle marking its front.
Legend: ${legend}

For each spatial preference below, decide whether the final layout realizes it: "realized", "partial" (some instances or only roughly), or "not_realized".
${affordances.map((a) => `- ${a.id}: ${a.statement}`).join('\n')}

Return one entry per id.`,
    schema: Schema,
    jsonSchema,
    imagePaths: [imagePath],
  });
  // categorical constraint enforced here: exactly one signal per retrieved affordance
  return affordances.map((a) => {
    const s = out.signals.find((x) => x.id === a.id);
    return { affordanceId: a.id, statement: a.statement, signal: s?.signal ?? 'not_realized', reason: s?.reason ?? 'no judgement returned' };
  });
}
