import { describe, expect, it } from "vitest";
import { buildEnvironment, snapObjects, roomAt } from "./environment";
import { LAYOUTS } from "./layouts";
import {
  composeVignette,
  evaluateDeviation,
  initRuntime,
  selectNpcActivity,
  step,
  isFinished,
  availableActivities,
} from "./engine";
import type { Project } from "./types";

const layout = LAYOUTS.find((l) => l.id === "studio")!;
const env = buildEnvironment(layout, [
  { roomId: "r1", name: "Kitchen", description: "" },
  { roomId: "r2", name: "Bedroom", description: "" },
]);

function project(): Project {
  const objects = snapObjects(env, [
    { id: "o1", name: "Stove", emoji: "🔥", description: "", roomId: "r1", x: 2, y: 2 },
    { id: "o2", name: "Bed", emoji: "🛏️", description: "", roomId: "r2", x: 14, y: 2 },
  ]);
  return {
    story: "A tiny story.",
    characters: [
      { id: "c1", name: "Mara", description: "", traits: [], isPlayer: true, color: "#f00", x: 4, y: 5 },
      { id: "c2", name: "Tomas", description: "", traits: [], isPlayer: false, color: "#00f", x: 13, y: 6 },
    ],
    layoutId: "studio",
    roomLabels: [],
    objects,
    environment: env,
    activities: [
      { id: "a1", objectId: "o1", verb: "cook on", description: "" },
      { id: "a2", objectId: "o2", verb: "sleep in", description: "" },
    ],
    events: [
      { id: "e1", description: "Tomas sleeps.", activityId: "a2", roomId: null, characterIds: ["c2"] },
      { id: "e2", description: "Mara cooks.", activityId: "a1", roomId: null, characterIds: ["c1"] },
    ],
    vignette: null,
  };
}

describe("tool_1 environment", () => {
  it("builds walls, floors and doors", () => {
    expect(env.tiles[0][0]).toBe("wall");
    expect(env.tiles[1][1]).toBe("floor");
    expect(env.tiles[5][9]).toBe("door");
    expect(roomAt(env, 12, 3)?.name).toBe("Bedroom");
  });
  it("snaps objects into their room and avoids collisions", () => {
    const o = snapObjects(env, [
      { id: "a", name: "A", emoji: "x", description: "", roomId: "r1", x: 50, y: 50 },
      { id: "b", name: "B", emoji: "x", description: "", roomId: "r1", x: 50, y: 50 },
    ]);
    expect(o).toHaveLength(2);
    expect(roomAt(env, o[0].x!, o[0].y!)?.id).toBe("r1");
    expect(`${o[0].x},${o[0].y}`).not.toBe(`${o[1].x},${o[1].y}`);
  });
});

describe("tool_2 engine", () => {
  it("composes a vignette and plays it to the end", () => {
    const { vignette: v, problems } = composeVignette(project(), "Test");
    expect(problems).toEqual([]);
    let s = initRuntime(v!);
    let plans: any[] = [];
    // NPC fallback performs event 1 (player not involved)
    for (let i = 0; i < 30 && s.eventIndex === 0; i++) {
      const r = step(v!, s, plans, { type: "wait" }, selectNpcActivity(v!, s, plans));
      s = r.state;
      plans = r.plans;
    }
    expect(s.completedEvents).toEqual(["e1"]);
    // Player walks to the stove
    const stove = v!.objects.find((o) => o.id === "o1")!;
    for (let i = 0; i < 30 && availableActivities(v!, s).every((a) => a.id !== "a1"); i++) {
      const me = s.positions.c1;
      const ax = stove.x! - me.x;
      const ay = stove.y! - me.y;
      const alongX = Math.abs(ax) >= Math.abs(ay);
      const dx = alongX ? Math.sign(ax) : 0;
      const dy = alongX ? 0 : Math.sign(ay);
      const action = { type: "move" as const, dx, dy };
      const before = s;
      s = step(v!, s, plans, action, {}).state;
      expect(evaluateDeviation(v!, before, s, action)).toBe("on_track");
    }
    const before = s;
    s = step(v!, s, plans, { type: "wait" }, {}).state;
    expect(evaluateDeviation(v!, before, s, { type: "wait" })).toBe("minor");
    s = step(v!, s, plans, { type: "interact", activityId: "a1" }, {}).state;
    expect(isFinished(s)).toBe(true);
  });

  it("rates acting out a future event as a major deviation", () => {
    const p = project();
    p.events[0].characterIds = ["c1"];
    p.events[1].activityId = "a1";
    const { vignette: v } = composeVignette(p, "T");
    const s = initRuntime(v!);
    const action = { type: "interact" as const, activityId: "a1" };
    expect(evaluateDeviation(v!, s, s, action)).toBe("major");
  });

  it("reports problems instead of composing an invalid vignette", () => {
    const p = project();
    p.characters.forEach((c) => (c.isPlayer = false));
    expect(composeVignette(p, "").vignette).toBeNull();
  });
});
