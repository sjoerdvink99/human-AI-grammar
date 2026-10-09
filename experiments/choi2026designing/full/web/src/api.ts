import type { MusicAttributes, Session } from "../../server/types.ts";
import type { TherapyFramework } from "../../server/framework.ts";

export type { Session, MusicAttributes, TherapyFramework };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const base = (id: string) => `/api/sessions/${id}`;

export const api = {
  framework: () => req<TherapyFramework>("GET", "/api/framework"),
  create: () => req<Session>("POST", "/api/sessions"),
  get: (id: string) => req<Session>("GET", base(id)),
  answer: (id: string, text: string) => req<Session>("POST", `${base(id)}/therapy/answer`, { text }),
  lyricInputs: (id: string, answers: string[]) => req<Session>("POST", `${base(id)}/lyrics/inputs`, { answers }),
  lyricsFeedback: (id: string, text: string) => req<Session>("POST", `${base(id)}/lyrics/feedback`, { text }),
  lyricsRegenerate: (id: string) => req<Session>("POST", `${base(id)}/lyrics/regenerate`),
  lyricsAccept: (id: string) => req<Session>("POST", `${base(id)}/lyrics/accept`),
  musicAttributes: (id: string, a: MusicAttributes) => req<Session>("POST", `${base(id)}/music/attributes`, a),
  songRegenerate: (id: string) => req<Session>("POST", `${base(id)}/music/regenerate`),
  songFeedback: (id: string, satisfied: boolean, text: string) => req<Session>("POST", `${base(id)}/song/feedback`, { satisfied, text }),
  reflection: (id: string, text: string) => req<Session>("POST", `${base(id)}/reflection`, { text }),
  retry: (id: string) => req<Session>("POST", `${base(id)}/retry`),
};
