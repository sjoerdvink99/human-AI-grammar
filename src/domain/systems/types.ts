import type { StructuralFeatures } from "../grammar/features";
import type { ParseResult } from "../grammar/types";

export interface PaperRecord {
  id: number;
  title: string;
  authors: string[];
  year: number;
  venue: string;
  citationKey: string;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  notes: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessRecord {
  id: number;
  name: string | null;
  description: string;
  rawExpression: string;
  order: number;
}

/** What the paper says about the model or tool behind an actor instance. Papers often leave this out, so every field is optional. */
export interface ActorDetails {
  name?: string;
  version?: string;
  provider?: string;
  kind?: string;
}

/** Actor details keyed by the actor instance used in the expressions, such as model_1 or tool. */
export type ActorCatalog = Record<string, ActorDetails>;

export interface SystemRecord {
  id: number;
  name: string;
  description: string;
  processScope: string | null;
  notes: string | null;
  actors: ActorCatalog;
  paper: PaperRecord;
  processes: ProcessRecord[];
}

export interface ParsedProcess extends ProcessRecord {
  result: ParseResult;
}

export interface SystemEntry extends Omit<SystemRecord, "processes"> {
  processes: ParsedProcess[];
  features: StructuralFeatures;
  searchText: string;
}
