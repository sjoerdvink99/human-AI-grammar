import type { Project, Concept } from "../../server/types.ts";
export type { Project, Concept };
export type { Scene, SceneVersion, PitchScore } from "../../server/types.ts";

async function req<T = Project>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body instanceof Blob ? { "Content-Type": body.type } : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export const api = {
  project: () => req("GET", "/api/project"),
  voices: () => req<{ voices: string[] }>("GET", "/api/voices"),
  reset: () => req("POST", "/api/reset"),
  setPaper: (text: string) => req("POST", "/api/paper", { text }),
  pdfToText: (file: File) => req<{ text: string }>("POST", "/api/paper/pdf", new Blob([file], { type: "application/pdf" })),
  runP1: () => req("POST", "/api/p1/run"),
  selectConcept: (index: number) => req("POST", "/api/p2/select", { index }),
  askAgain: () => req("POST", "/api/p2/questions"),
  writeScript: (answers: string[], notes: string) => req("POST", "/api/p2/script", { answers, notes }),
  saveConcept: (concept: Concept) => req("PUT", "/api/concept", { concept }),
  planScenes: () => req("POST", "/api/p4/plan"),
  produce: (voice: string) => req("POST", "/api/p4/produce", { voice }),
  revoice: (sceneId: string, voice: string) => req("POST", "/api/p5/revoice", { sceneId, voice }),
  editScene: (sceneId: string, text: string) => req("POST", "/api/p6/edit", { sceneId, text }),
  prepareTitle: () => req("POST", "/api/p7/prepare"),
  composeTitle: (text: string) => req("PUT", "/api/p7/title", { text }),
};
