import { z } from "zod";
import { parseProcess } from "../grammar/parser";

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

export const systemInputSchema = recordSchema(grammarExpression);

export type SystemInput = z.infer<typeof systemInputSchema>;

export type SystemInputJson = z.input<typeof systemInputSchema>;
