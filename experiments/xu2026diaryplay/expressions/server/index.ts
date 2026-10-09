import express from "express";
import path from "node:path";
import fs from "node:fs";
import * as ops from "./operations";

const app = express();
app.use(express.json({ limit: "5mb" }));

type Handler = (body: any) => Promise<unknown>;

function route(name: string, handler: Handler) {
  app.post(`/api/${name}`, async (req, res) => {
    const t0 = Date.now();
    try {
      const result = await handler(req.body ?? {});
      console.log(`[${name}] ok in ${Date.now() - t0} ms`);
      res.json(result);
    } catch (e: any) {
      console.error(`[${name}] failed:`, e?.message);
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });
}

function need(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Process 1
route("extract-characters", async (b) => {
  need(typeof b.story === "string" && b.story.trim().length > 20, "Write a story of at least a few sentences.");
  return { characters: await ops.extractCharacters(b.story) };
});
route("select-layout", async (b) => ops.selectLayout(b.story, b.characters));
route("assign-room-labels", async (b) => ({ roomLabels: await ops.assignRoomLabels(b.story, b.layoutId, b.characters) }));
route("generate-objects", async (b) => ({ objects: await ops.generateObjects(b.story, b.layoutId, b.characters, b.roomLabels) }));
route("place-objects", async (b) => ({ objects: await ops.placeObjects(b.story, b.environment, b.objects) }));

// Process 2
route("interview-reply", async (b) => {
  need(b.message?.trim(), "Write a question first.");
  return { reply: await ops.interviewReply(b.story, b.character, b.characters, b.message) };
});
route("suggest-traits", async (b) => ({ traits: await ops.suggestTraits(b.story, b.character, b.reply) }));

// Process 3
route("extract-activities", async (b) => ({ activities: await ops.extractActivities(b.story, b.environment, b.objects, b.characters) }));
route("compose-events", async (b) => ({ events: await ops.composeEvents(b.story, b.environment, b.objects, b.characters, b.activities) }));
route("assign-event-characters", async (b) => ({ events: await ops.assignEventCharacters(b.story, b.characters, b.events) }));

// Process 4–6
route("plan-npcs", async (b) => ({ plans: await ops.planNpcs(b.vignette, b.runtimeState) }));
route("npc-reply", async (b) => {
  need(b.playerMessage?.trim(), "Say something first.");
  return { reply: await ops.npcReply(b.vignette, b.runtimeState, b.npcId, b.playerMessage) };
});
route("inner-voice", async (b) => ({ text: await ops.innerVoice(b.vignette, b.runtimeState, b.deviation) }));

const dist = path.resolve("dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
