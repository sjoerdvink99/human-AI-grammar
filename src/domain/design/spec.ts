import { z } from "zod";
import { parseProcess } from "../grammar/parser";
import type { ParseResult } from "../grammar/types";

interface DesignProcess {
  name?: string;
  description?: string;
  rawExpression: string;
}

export const designSpecSchema = z.object({
  name: z.string().trim().default(""),
  goal: z.string().trim().default(""),
  description: z.string().trim().default("").meta({ description: "How the system works as a whole and how its processes fit together" }),
  processes: z
    .array(
      z
        .object({
          name: z.string().trim().optional(),
          description: z.string().trim().optional().meta({ description: "What happens in the process, in plain language, and when it runs or repeats" }),
          note: z.string().trim().optional().meta({ description: "Deprecated: read into description" }),
          rawExpression: z.string(),
        })
        .transform(({ note, description = note, ...process }): DesignProcess => (description ? { ...process, description } : process)),
    )
    .min(1),
  representations: z
    .record(z.string(), z.string().trim())
    .default({})
    .meta({ description: "What each representation contains, keyed by identifier without its version" }),
  references: z.array(z.string().trim().min(1)).default([]),
  images: z
    .array(
      z.object({
        src: z.string().regex(/^data:image\/[\w+.-]+;base64,/, "Use a base64 image data URL"),
        note: z.string().trim().default(""),
      }),
    )
    .default([])
    .meta({ description: "Sketches or images of the system, each with a note on what it shows" }),
});

export type DesignSpec = z.infer<typeof designSpecSchema>;

export const designParam = "d";

export const emptySpec = (): DesignSpec => ({
  name: "",
  goal: "",
  description: "",
  processes: [{ rawExpression: "" }],
  representations: {},
  references: [],
  images: [],
});

export const representationName = (id: string) => id.replace(/_\d+$/, "");

export interface NamedRepresentation {
  name: string;
  ids: string[];
  types: string[];
}

export function namedRepresentations(rawExpressions: string[]): NamedRepresentation[] {
  const named = new Map<string, NamedRepresentation>();
  for (const [, id, role, medium, star] of rawExpressions.join("\n").matchAll(/\(\s*([\p{L}\p{N}_-]+)\s*:\s*([\p{L}\p{N}_-]+)\s+([\p{L}\p{N}_-]+)\s*\)(\*?)/gu)) {
    const name = representationName(id);
    const entry = named.get(name) ?? { name, ids: [], types: [] };
    if (!entry.ids.includes(id)) entry.ids.push(id);
    const type = `${role} ${medium}${star}`;
    if (!entry.types.includes(type)) entry.types.push(type);
    named.set(name, entry);
  }
  return [...named.values()];
}

function toBase64Url(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function encodeSpec(spec: DesignSpec): string {
  return toBase64Url(JSON.stringify(spec));
}

function specSource(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  if (/^https?:\/\//.test(trimmed) || trimmed.includes(`${designParam}=`)) {
    return fromBase64Url(new RegExp(`[?#&]${designParam}=([^&#]*)`).exec(trimmed)?.[1] ?? "");
  }
  return fromBase64Url(trimmed);
}

export function decodeSpec(value: string | null | undefined): DesignSpec | null {
  if (!value?.trim()) return null;
  try {
    const result = designSpecSchema.safeParse(JSON.parse(specSource(value)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseSpec(spec: DesignSpec): ParseResult[] {
  return spec.processes.map((process) => parseProcess(process.rawExpression));
}

export function isComplete(spec: DesignSpec): boolean {
  return parseSpec(spec).every((result) => result.ok);
}

export function specFileName(spec: DesignSpec): string {
  const slug = spec.name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "design"}.json`;
}
