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
  rawExpression: string;
  order: number;
}

export interface SystemRecord {
  id: number;
  name: string;
  description: string;
  processScope: string | null;
  notes: string | null;
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
