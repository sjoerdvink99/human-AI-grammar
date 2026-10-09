export interface ProcessDraft {
  key: string;
  name: string;
  rawExpression: string;
}

export function newProcess(rawExpression = "", name = ""): ProcessDraft {
  return { key: crypto.randomUUID(), name, rawExpression };
}
