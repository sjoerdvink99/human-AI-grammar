import { z } from "zod";
import { parseProcess } from "../grammar/parser";
import { formatActor } from "../grammar/formatter";

const text = z.string().trim().min(1);

const optionalText = z.string().trim().min(1).optional();

const grammarExpression = text.superRefine((expression, context) => {
  const result = parseProcess(expression);
  if (!result.ok) {
    context.addIssue({
      code: "custom",
      message: `Line ${result.error.line}, column ${result.error.column}: ${result.error.message}`,
    });
  }
});

const actorDetails = z
  .object({
    name: optionalText.meta({ description: "Model or tool name as the paper gives it, e.g. GPT-4o, Stable Diffusion XL, Semantic Scholar API" }),
    version: optionalText.meta({ description: "Specific version, snapshot, checkpoint, or size, e.g. gpt-4o-2024-08-06, 1.0, 70B" }),
    provider: optionalText.meta({ description: "Organisation that provides it, e.g. OpenAI, Stability AI" }),
    kind: optionalText.meta({ description: "Kind of model or tool, e.g. language model, diffusion model, vision-language model, search API" }),
  })
  .strict()
  .refine((details) => Object.values(details).some(Boolean), "Give at least one detail, or leave the actor out");

const actorKey = z.string().regex(/^(model|tool)(_[\p{L}\p{N}_-]+)?$/iu, "Use a model or tool actor as it appears in the expressions, e.g. model_1");

function recordSchema(expression: z.ZodType<string, string>) {
  return z.object({
    paper: z.object({
      title: text,
      authors: z.array(text).min(1),
      year: z.number().int().min(1900).max(2100),
      venue: text.meta({ description: "Short venue name, e.g. CHI, UIST, IEEE VIS, arXiv" }),
      citationKey: text.regex(/^[\w:.-]+$/, "Use letters, digits, and _ : . - only"),
      doi: optionalText.meta({ description: "Bare DOI without https://doi.org/" }),
      url: z.url().optional(),
      abstract: optionalText,
      notes: optionalText,
      tags: z.array(text).default([]),
    }),
    system: z.object({
      name: text,
      description: z.string().trim().default(""),
      processScope: optionalText.meta({ description: "Which part of the system the processes describe" }),
      notes: optionalText,
      actors: z
        .record(actorKey, actorDetails)
        .default({})
        .meta({ description: "Known details of the models and tools behind the actor instances; omit what the paper does not say" }),
    }),
    processes: z
      .array(
        z.object({
          name: optionalText,
          description: text.meta({
            description: "Plain-language summary of what happens in this process and who or what does it",
          }),
          rawExpression: expression.meta({
            description: "One grammar process: state (-> [actor operation] -> state)+",
          }),
        }),
      )
      .min(1),
  });
}

export const systemRecordSchema = recordSchema(text);

// Actor details may only describe actors that appear in the system's expressions.
export const systemInputSchema = recordSchema(grammarExpression).superRefine((record, context) => {
  const used = new Set(
    record.processes.flatMap(({ rawExpression }) => {
      const result = parseProcess(rawExpression);
      return result.ok ? result.process.transforms.map(formatActor) : [];
    }),
  );
  for (const actor of Object.keys(record.system.actors)) {
    if (!used.has(actor)) context.addIssue({ code: "custom", path: ["system", "actors", actor], message: `Actor '${actor}' does not appear in any process` });
  }
});

export type SystemInput = z.infer<typeof systemInputSchema>;

export type SystemInputJson = z.input<typeof systemInputSchema>;
