export interface ProcessDraft {
  key: string;
  name: string;
  description: string;
  rawExpression: string;
}

export function newProcess(rawExpression = "", name = "", description = ""): ProcessDraft {
  return { key: crypto.randomUUID(), name, description, rawExpression };
}
