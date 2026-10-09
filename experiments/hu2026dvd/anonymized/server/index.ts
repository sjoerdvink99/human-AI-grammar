import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "./routes";

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use("/api", api);

const dist = resolve(import.meta.dirname, "../dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`System X API on http://localhost:${port}`));
