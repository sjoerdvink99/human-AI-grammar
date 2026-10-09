import type { ActorKind } from "@/domain/grammar/types";

export const categoryColors = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];

export const otherColor = "#b4b9c0";

export const mutedColor = "#d5d8dd";

export const actorPalette: Record<ActorKind, string> = { human: "#d0602c", model: "#2a78d6", tool: "#1a9a6c" };

export const groupColors = ["#2a78d6", "#eb6834", "#1baf7a", "#a855c7", "#5b626d"];

export const maxGroups = groupColors.length;

const shapes = [
  (r: number) => `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`,
  (r: number) => `M${-r * 0.88},${-r * 0.88}h${r * 1.76}v${r * 1.76}h${-r * 1.76}z`,
  (r: number) => `M0,${-r * 1.15}L${r * 1.1},${r * 0.8}H${-r * 1.1}z`,
  (r: number) => `M0,${-r * 1.25}L${r * 1.1},0L0,${r * 1.25}L${-r * 1.1},0z`,
  (r: number) => `M${-r * 0.4},${-r}h${r * 0.8}v${r * 0.6}h${r * 0.6}v${r * 0.8}h${-r * 0.6}v${r * 0.6}h${-r * 0.8}v${-r * 0.6}h${-r * 0.6}v${-r * 0.8}h${r * 0.6}z`,
];

export function markerPath(group: number | undefined, radius: number): string {
  return shapes[(group ?? 0) % shapes.length](radius);
}

export const swatchPath = "M-5,-5h10v10h-10z";

export function GroupMarker({ group }: { group: number }) {
  return (
    <svg viewBox="-7 -7 14 14" className="size-3.5 shrink-0" aria-hidden>
      <path d={markerPath(group, 5)} fill={groupColors[group]} />
    </svg>
  );
}
