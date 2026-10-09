import type { Transform } from "@/domain/grammar/types";
import { actorKinds } from "@/domain/grammar/types";
import { cx } from "@/lib/cx";
import { actorPalette } from "./markers";

export function ActorStrip({ transforms, highlight }: { transforms: Transform[]; highlight?: ReadonlySet<number> }) {
  return (
    <span className="inline-flex gap-px align-middle">
      {transforms.map((transform, index) => (
        <span
          key={index}
          title={`${transform.actor} ${transform.operation}${transform.generative ? " ~" : ""}`}
          className={cx("relative h-3.5 w-1.5 rounded-[1px]", highlight && !highlight.has(index) && "opacity-20")}
          style={{ background: actorPalette[transform.actor] }}
        >
          {transform.generative && <span className="absolute top-1/2 left-1/2 size-[3px] -translate-1/2 rounded-full bg-white" />}
        </span>
      ))}
    </span>
  );
}

export function ActorLegend({ generative = true }: { generative?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3 text-faint">
      {actorKinds.map((actor) => (
        <span key={actor} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-1.5 rounded-[1px]" style={{ background: actorPalette[actor] }} />
          {actor}
        </span>
      ))}
      {generative && (
        <span className="inline-flex items-center gap-1.5">
          <span className="relative h-2.5 w-1.5 rounded-[1px] bg-faint">
            <span className="absolute top-1/2 left-1/2 size-[3px] -translate-1/2 rounded-full bg-white" />
          </span>
          generative
        </span>
      )}
    </span>
  );
}

export function Step({ actor, operation }: { actor: Transform["actor"]; operation: string }) {
  return (
    <span className="font-mono text-[12px] whitespace-nowrap" style={{ color: actorPalette[actor] }}>
      {actor} {operation}
    </span>
  );
}
