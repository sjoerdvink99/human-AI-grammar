import { dimensions } from "@/domain/systems/dimensions";
import { emptyQuery, type Range, type SystemQuery } from "@/domain/systems/filters";

type ListField = {
  [K in keyof SystemQuery]: SystemQuery[K] extends string[] ? K : never;
}[keyof SystemQuery];

const listParams: Record<ListField, string> = {
  actors: "actor",
  operations: "op",
  roles: "role",
  media: "medium",
  representationTypes: "rep",
  actorOperations: "pair",
  venues: "venue",
  scopes: "scope",
};

const listFields = Object.keys(listParams) as ListField[];

const queryParamNames = ["q", "stochastic", "year", ...Object.values(listParams), ...dimensions.map((d) => d.key)];

function toNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseRange(value: string | null): Range {
  if (!value) return {};
  const [min = "", max = min] = value.split("..");
  return { min: toNumber(min), max: toNumber(max) };
}

export function formatRange({ min, max }: Range): string | null {
  if (min === undefined && max === undefined) return null;
  return `${min ?? ""}..${max ?? ""}`;
}

export function readQuery(params: URLSearchParams): SystemQuery {
  const ranges = Object.fromEntries(
    dimensions.filter((d) => params.has(d.key)).map((d) => [d.key, parseRange(params.get(d.key))]),
  );
  return {
    ...emptyQuery,
    ...Object.fromEntries(listFields.map((field) => [field, params.getAll(listParams[field])])),
    text: params.get("q") ?? "",
    stochastic: params.get("stochastic") === "1",
    year: parseRange(params.get("year")),
    ranges,
  };
}

export function writeQuery(query: SystemQuery, params: URLSearchParams): void {
  queryParamNames.forEach((name) => params.delete(name));
  if (query.text) params.set("q", query.text);
  listFields.forEach((field) => query[field].forEach((value) => params.append(listParams[field], value)));
  if (query.stochastic) params.set("stochastic", "1");
  const year = formatRange(query.year);
  if (year) params.set("year", year);
  Object.entries(query.ranges).forEach(([key, range]) => params.set(key, formatRange(range) ?? ".."));
}

export function systemsHref(params: Record<string, string>): string {
  return `/systems?${new URLSearchParams(params).toString()}`;
}
