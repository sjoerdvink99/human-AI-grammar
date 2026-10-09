import { describe, expect, it } from "vitest";
import { decodeSpec, emptySpec, encodeSpec, isComplete, namedRepresentations, specFileName, type DesignSpec } from "./spec";

const spec: DesignSpec = {
  name: "Évaluation helper",
  goal: "Draft and critique",
  processes: [{ name: "draft", rawExpression: "(p_1: instruction language)\n-> [model generate]~\n-> (a_1: artifact language)" }],
  representations: { a: "a short story about cats or dogs" },
  references: ["nguyen2018believe"],
};

describe("design spec", () => {
  it("round-trips through the URL encoding", () => {
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
  });

  it("decodes design links and raw JSON", () => {
    expect(decodeSpec(`https://example.org/design/?d=${encodeSpec(spec)}`)).toEqual(spec);
    expect(decodeSpec(JSON.stringify({ processes: spec.processes }))).toMatchObject({ name: "", representations: {}, references: [] });
  });

  it("rejects invalid input", () => {
    expect(decodeSpec("not base64 !")).toBeNull();
    expect(decodeSpec(JSON.stringify({ processes: [] }))).toBeNull();
    expect(decodeSpec(null)).toBeNull();
  });

  it("is complete only when every process parses", () => {
    expect(isComplete(spec)).toBe(true);
    expect(isComplete(emptySpec())).toBe(false);
  });

  it("groups representations by identifier without version", () => {
    expect(
      namedRepresentations(["(p_1: instruction language) -> [model generate]~ -> (a_1: artifact language)", "(a_1: artifact language) -> [human modify] -> (a_2: artifact language) + (r: selection spatial)"]),
    ).toEqual([
      { name: "p", ids: ["p_1"], types: ["instruction language"] },
      { name: "a", ids: ["a_1", "a_2"], types: ["artifact language"] },
      { name: "r", ids: ["r"], types: ["selection spatial"] },
    ]);
  });

  it("derives a file name from the system name", () => {
    expect(specFileName(spec)).toBe("évaluation-helper.json");
    expect(specFileName(emptySpec())).toBe("design.json");
  });
});
