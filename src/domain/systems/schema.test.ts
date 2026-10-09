import { describe, expect, it } from "vitest";
import { describeActor } from "./actors";
import { systemInputSchema } from "./schema";

const record = (actors?: unknown) => ({
  paper: { title: "Paper", authors: ["Ada Lovelace"], year: 2024, venue: "CHI", citationKey: "lovelace2024paper" },
  system: { name: "System", ...(actors !== undefined && { actors }) },
  processes: [
    {
      description: "The user writes a prompt and an image model draws it.",
      rawExpression: "(prompt_1: instruction language) -> [model_1 expand]~ -> (prompt_2: instruction language) -> [model_2 generate]~ -> (image_1: artifact visual)",
    },
  ],
});

const issues = (input: unknown) => systemInputSchema.safeParse(input).error?.issues.map(({ message }) => message) ?? [];

describe("system actors", () => {
  it("defaults to no actor details, since papers often do not name their models", () => {
    expect(systemInputSchema.parse(record()).system.actors).toEqual({});
  });

  it("accepts partial details for actors used in the processes", () => {
    const actors = { model_1: { name: "GPT-4o", provider: "OpenAI", kind: "language model" }, model_2: { kind: "diffusion model" } };
    expect(systemInputSchema.parse(record(actors)).system.actors).toEqual(actors);
  });

  it("rejects details for an actor that no process uses", () => {
    expect(issues(record({ model_3: { name: "Claude" } }))).toEqual(["Actor 'model_3' does not appear in any process"]);
  });

  it("rejects an actor entry without any detail", () => {
    expect(issues(record({ model_1: {} }))).toEqual(["Give at least one detail, or leave the actor out"]);
  });

  it("rejects unknown fields and actors that are not models or tools", () => {
    expect(issues(record({ model_1: { name: "GPT-4o", temperature: "0.7" } })).length).toBeGreaterThan(0);
    expect(issues(record({ human: { name: "Designer" } })).length).toBeGreaterThan(0);
  });
});

describe("describeActor", () => {
  it("joins the known details into one line", () => {
    expect(describeActor({ name: "GPT-4o", version: "gpt-4o-2024-08-06", provider: "OpenAI", kind: "language model" })).toBe(
      "GPT-4o (gpt-4o-2024-08-06) · OpenAI · language model",
    );
    expect(describeActor({ kind: "diffusion model" })).toBe("diffusion model");
  });
});
