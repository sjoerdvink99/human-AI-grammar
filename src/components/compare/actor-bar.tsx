import { actorKinds, type ActorKind } from "@/domain/grammar/types";

export const actorColors: Record<ActorKind, string> = {
  human: "var(--color-human)",
  model: "var(--color-model)",
  tool: "var(--color-tool)",
};

export function ActorBar({ actors }: { actors: Record<ActorKind, number> }) {
  const total = actorKinds.reduce((sum, kind) => sum + actors[kind], 0);
  return (
    <div>
      <div className="flex h-2 w-full max-w-56 gap-0.5 overflow-hidden rounded-sm bg-wash">
        {actorKinds
          .filter((kind) => actors[kind] > 0)
          .map((kind) => (
            <div key={kind} style={{ width: `${(actors[kind] / total) * 100}%`, background: actorColors[kind] }} />
          ))}
      </div>
      <p className="mt-1 text-xs text-muted tabular-nums">
        {actorKinds.map((kind) => `${actors[kind]} ${kind}`).join(" · ")}
      </p>
    </div>
  );
}

export function ActorLegend() {
  return (
    <span className="inline-flex items-center gap-3">
      {actorKinds.map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: actorColors[kind] }} />
          {kind}
        </span>
      ))}
    </span>
  );
}
