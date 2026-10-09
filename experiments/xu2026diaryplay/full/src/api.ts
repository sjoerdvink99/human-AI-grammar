/** Client for the server endpoints; one function per model operation. */
async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

export const api = {
  // Process 1
  extractCharacters: (b: object) => post<{ characters: import('../shared/types').Character[] }>('/api/p1/extract-characters', b),
  selectLayout: (b: object) => post<{ layoutId: string; reason: string }>('/api/p1/select-layout', b),
  assignRoomLabels: (b: object) => post<{ roomLabels: import('../shared/types').RoomLabels }>('/api/p1/assign-room-labels', b),
  generateObjects: (b: object) => post<{ objects: import('../shared/types').GameObject[] }>('/api/p1/generate-objects', b),
  assignObjects: (b: object) => post<{ objects: import('../shared/types').GameObject[] }>('/api/p1/assign-objects', b),
  // Process 2
  personaReply: (b: object) => post<{ reply: string }>('/api/p2/reply', b),
  suggestTraits: (b: object) => post<{ traits: string[] }>('/api/p2/traits', b),
  // Process 3
  extractActivities: (b: object) => post<{ activities: import('../shared/types').Activity[] }>('/api/p3/extract-activities', b),
  composeEvents: (b: object) => post<{ events: import('../shared/types').KeyEvent[] }>('/api/p3/compose-events', b),
  orderEvents: (b: object) => post<{ events: import('../shared/types').KeyEvent[] }>('/api/p3/order-events', b),
  // Process 4–6
  npcPlans: (b: object) => post<{ plans: import('../shared/types').NpcPlan[] }>('/api/p4/npc-plans', b),
  npcReply: (b: object) => post<{ reply: string }>('/api/p5/npc-reply', b),
  innerVoice: (b: object) => post<{ innerVoice: string }>('/api/p6/inner-voice', b),
  // storage
  saveVignette: (v: import('../shared/types').Vignette) => post<{ id: string }>('/api/vignettes', v),
  listVignettes: async () => (await fetch('/api/vignettes')).json() as Promise<{ id: string; title: string; createdAt: string }[]>,
  getVignette: async (id: string) => { const r = await fetch(`/api/vignettes/${id}`); if (!r.ok) throw new Error('Vignette not found'); return r.json() as Promise<import('../shared/types').Vignette>; },
};
