import { describe, expect, it } from "vitest";
import { loops } from "../grammar/features";
import { parseProcess } from "../grammar/parser";
import { tasks, type TaskId } from "./study";

describe.each(Object.keys(tasks) as TaskId[])("task %s", (id) => {
  const processes = tasks[id].reference.map((expression) => {
    const result = parseProcess(expression);
    if (!result.ok) throw new Error(result.error.message);
    return result.process;
  });

  it("has a reference that exercises the grammar", () => {
    const actors = new Set(processes.flatMap(({ transforms }) => transforms.map(({ actor }) => actor)));
    expect(actors).toEqual(new Set(["human", "model", "tool"]));
    expect(processes.some((process) => loops(process).length > 0)).toBe(true);
  });
});
