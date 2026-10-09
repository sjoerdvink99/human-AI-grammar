import type { Project } from "../../server/types.ts";

export type ProjectView = Project & { sceneStatus: Record<number, string> };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

const p = (id: string, rest = "") => `/api/projects/${id}${rest}`;

export const api = {
  list: () => call<{ id: string; title: string; createdAt: string }[]>("GET", "/api/projects"),
  create: () => call<ProjectView>("POST", "/api/projects"),
  get: (id: string) => call<ProjectView>("GET", p(id)),
  uploadPaper: (id: string, form: FormData) => call<ProjectView>("POST", p(id, "/paper"), form),
  pastePaper: (id: string, title: string, text: string) => call<ProjectView>("POST", p(id, "/paper"), { title, text }),
  step: (id: string, step: string, body: unknown = {}) => call<ProjectView>("POST", p(id, `/${step}`), body),
  saveScript: (id: string, script: unknown) => call<ProjectView>("PUT", p(id, "/script"), script),
  regenerate: (id: string, i: number, regenerationRequest: string) =>
    call<ProjectView>("POST", p(id, `/scenes/${i}/regenerate`), { regenerationRequest }),
  revise: (id: string, i: number, text: string) => call<ProjectView>("POST", p(id, `/scenes/${i}/revise`), { text }),
  revert: (id: string, i: number, historyIndex: number) => call<ProjectView>("POST", p(id, `/scenes/${i}/revert`), { historyIndex }),
};
