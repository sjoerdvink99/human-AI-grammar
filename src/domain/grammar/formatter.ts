import type { Process, Representation, State, Transform } from "./types";

export function formatRepresentation({ id, role, medium }: Representation): string {
  return `(${id}: ${role} ${medium})`;
}

export function formatState(state: State): string {
  return state.representations.map(formatRepresentation).join(" + ");
}

export function formatActor(transform: Transform): string {
  return transform.actorInstance ?? transform.actor;
}

export function formatTransform(transform: Transform): string {
  return `[${formatActor(transform)} ${transform.operation}]${transform.stochastic ? "~" : ""}`;
}

export function formatProcess(process: Process, separator = "\n"): string {
  const lines = [formatState(process.states[0])];
  process.transforms.forEach((transform, index) => {
    lines.push(`-> ${formatTransform(transform)}`, `-> ${formatState(process.states[index + 1])}`);
  });
  return lines.join(separator);
}
