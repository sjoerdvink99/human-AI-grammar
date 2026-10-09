export const actorKinds = ["human", "model", "tool"] as const;

export type ActorKind = (typeof actorKinds)[number];

export interface Representation {
  id: string;
  role: string;
  medium: string;
  collection?: boolean;
}

export interface State {
  representations: Representation[];
}

export interface Transform {
  actor: ActorKind;
  actorInstance?: string;
  operation: string;
  generative: boolean;
}

export interface Process {
  states: State[];
  transforms: Transform[];
}

export interface SourceSpan {
  offset: number;
  length: number;
  line: number;
  column: number;
}

export interface ParseError extends SourceSpan {
  message: string;
}

export type ParseResult =
  | { ok: true; process: Process }
  | { ok: false; error: ParseError };
