import { z } from 'zod';

/** Visual kinds the scene renderer (tool_2) knows how to draw. */
export const VISUAL_KINDS = ['headline', 'big_number', 'bar', 'comparison', 'quote'] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const VisualSchema = z.object({
  kind: z.enum(VISUAL_KINDS),
  label: z.string().max(120),
  value: z.string().max(40).describe('Headline number or short value, e.g. "42%"; empty if not used'),
  items: z
    .array(z.object({ label: z.string().max(40), value: z.number() }))
    .max(6)
    .describe('Data points for bar / comparison visuals; empty otherwise'),
});

/** scripts: one scene of the data video (artifact record). */
export const SceneSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(80),
  narration: z.string().min(1).max(400),
  onScreenText: z.string().max(120),
  visual: VisualSchema,
  background: hex,
  accent: hex,
  durationSec: z.number().min(2).max(15),
  factIndexes: z.array(z.number().int().min(0)).describe('0-based indexes of the data facts this scene uses'),
});

/** model_1 output: the collection of scripts. */
export const ScriptsOutputSchema = z.object({
  scenes: z.array(SceneSchema.omit({ id: true })).min(2).max(10),
});

/** model_2 output: clip as a self-contained animated SVG. */
export const ClipOutputSchema = z.object({
  svg: z.string().min(20),
  caption: z.string(),
});

/** model_3 output: polygon mask around the clicked object (normalized 0..1). */
export const MaskOutputSchema = z.object({
  found: z.boolean(),
  objectName: z.string(),
  polygon: z.array(z.array(z.number()).length(2)).max(64),
});
