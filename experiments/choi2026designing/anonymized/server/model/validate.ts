// Small runtime validators for model outputs (generative outputs are validated before use).
export function obj(x: unknown, what: string): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error(`${what}: expected object`);
  return x as Record<string, unknown>;
}
export function str(x: unknown, what: string, { nonEmpty = true } = {}): string {
  if (typeof x !== "string") throw new Error(`${what}: expected string`);
  const s = x.trim();
  if (nonEmpty && !s) throw new Error(`${what}: empty`);
  return s;
}
export function strArr(x: unknown, what: string): string[] {
  if (!Array.isArray(x)) throw new Error(`${what}: expected array`);
  return x.map((v, i) => str(v, `${what}[${i}]`));
}
export function num(x: unknown, what: string, min: number, max: number): number {
  const n = typeof x === "string" ? Number(x) : x;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${what}: expected number`);
  return Math.min(max, Math.max(min, n));
}
export function oneOf<T extends string>(x: unknown, what: string, values: readonly T[], fallback: T): T {
  return values.includes(x as T) ? (x as T) : fallback;
}
