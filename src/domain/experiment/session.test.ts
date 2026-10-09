import { describe, expect, it } from "vitest";
import { decodeSpec } from "../design/spec";
import { newSession, newStudy, sessionFile } from "./session";
import { tutorialCanvas } from "./study";

const timed = { started: "2026-11-10T10:00:00.000Z", finished: "2026-11-10T10:15:30.000Z" };

describe("newStudy", () => {
  it("randomises the condition order and keeps the task order", () => {
    const parts = (draw: number) => newStudy("P01", () => draw).map(({ part, condition, task, phase }) => ({ part, condition, task, phase }));
    expect(parts(0.2)).toEqual([
      { part: 1, condition: "text", task: "A", phase: "brief" },
      { part: 2, condition: "canvas", task: "B", phase: "tutorial" },
    ]);
    expect(parts(0.8)).toEqual([
      { part: 1, condition: "canvas", task: "A", phase: "tutorial" },
      { part: 2, condition: "text", task: "B", phase: "brief" },
    ]);
  });
});

describe("sessionFile", () => {
  it("writes the text condition as a prompt with frontmatter", () => {
    const session = { ...newSession("P 03", 1, "text", "A"), ...timed, name: "Checker", goal: "Verify claims", prompt: "Build a tool that…" };
    const file = sessionFile(session);
    expect(file.name).toBe("P-03-1-text-A.md");
    expect(file.content).toBe(
      [
        "---",
        'participant: "P 03"',
        "part: 1",
        'condition: "text"',
        'task: "A"',
        'started: "2026-11-10T10:00:00.000Z"',
        'finished: "2026-11-10T10:15:30.000Z"',
        "seconds: 930",
        "---",
        "",
        "# Checker",
        "",
        "Goal: Verify claims",
        "",
        "Build a tool that…",
        "",
      ].join("\n"),
    );
  });

  it("writes the canvas condition as a design the plugin can read", () => {
    const session = { ...newSession("P03", 2, "canvas", "B"), ...timed, name: "Drafts", canvas: tutorialCanvas, events: [{ at: timed.started, type: "connect" }] };
    const file = sessionFile(session);
    const content = JSON.parse(file.content);
    expect(file.name).toBe("P03-2-canvas-B.json");
    expect(content.study).toMatchObject({ participant: "P03", seconds: 930, events: session.events });
    expect(content.canvas.nodes).toHaveLength(tutorialCanvas.nodes.length);
    expect(decodeSpec(file.content)?.processes).toHaveLength(1);
  });
});
