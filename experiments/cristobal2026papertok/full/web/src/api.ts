import type { Project, ScriptRecord } from '../../server/types.ts';
export type { Project, ScriptRecord };
export type { Scene, ClipVersion } from '../../server/types.ts';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? r.statusText);
  return data as T;
}

const P = (id: string) => `/api/projects/${id}`;

export const api = {
  list: () => req<{ id: string; title: string; createdAt: string; hasVideo: boolean }[]>('GET', '/api/projects'),
  get: (id: string) => req<Project>('GET', P(id)),
  upload: (file: File) => { const f = new FormData(); f.append('paper', file); return req<Project>('POST', '/api/projects', f); },
  regenerateScripts: (id: string) => req<Project>('POST', `${P(id)}/scripts/regenerate`),
  selectScript: (id: string, option: number) => req<Project>('POST', `${P(id)}/select-script`, { option }),
  suggestTone: (id: string) => req<Project>('POST', `${P(id)}/tone/suggest`),
  setVoiceStyle: (id: string, tonePreference: string) => req<Project>('POST', `${P(id)}/voice-style`, { tonePreference }),
  saveScript: (id: string, script: ScriptRecord) => req<Project>('PUT', `${P(id)}/script`, { script }),
  revertScript: (id: string) => req<Project>('POST', `${P(id)}/script/revert`),
  prepareStoryboard: (id: string) => req<Project>('POST', `${P(id)}/storyboard`),
  generateScenes: (id: string, scene: 'all' | number) => req<Project>('POST', `${P(id)}/scenes/generate`, { scene }),
  regenerateScene: (id: string, i: number) => req<Project>('POST', `${P(id)}/scenes/${i}/regenerate`),
  reviseScene: (id: string, i: number, script: string) => req<Project>('PUT', `${P(id)}/scenes/${i}/script`, { script }),
  restoreClip: (id: string, i: number, version: number) => req<Project>('POST', `${P(id)}/scenes/${i}/restore`, { version }),
  prepareCredits: (id: string) => req<Project>('POST', `${P(id)}/credits/prepare`),
  saveCredits: (id: string, creditText: string) => req<Project>('PUT', `${P(id)}/credits`, { creditText }),
  merge: (id: string, approved: number[]) => req<Project>('POST', `${P(id)}/merge`, { approved }),
};
