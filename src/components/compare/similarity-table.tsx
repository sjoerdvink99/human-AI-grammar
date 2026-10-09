import type { PairSimilarity } from "@/domain/analysis/comparison";
import { measures } from "@/domain/grammar/similarity";
import { formatScore } from "@/lib/format";

function Score({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-sm bg-wash">
        <span className="block h-full bg-accent/70" style={{ width: `${value * 100}%` }} />
      </span>
      <span className="w-8 text-right tabular-nums">{formatScore(value)}</span>
    </span>
  );
}

export function SimilarityTable({ pairs }: { pairs: PairSimilarity[] }) {
  return (
    <div className="space-y-4">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line-strong text-xs text-muted">
            <th className="py-2 text-left font-medium">Pair</th>
            <th className="w-40 py-2 text-right font-medium">Overall</th>
            <th className="w-40 py-2 text-right font-medium">Representation</th>
            <th className="w-40 py-2 text-right font-medium">Transformation</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map(({ a, b, result }) => (
            <tr key={`${a.id}-${b.id}`} className="border-b border-line">
              <td className="py-2">
                {a.name} <span className="text-faint">×</span> {b.name}
              </td>
              <td className="py-2 text-right font-medium">
                <Score value={result.overall} />
              </td>
              <td className="py-2 text-right">
                <Score value={result.representation} />
              </td>
              <td className="py-2 text-right">
                <Score value={result.transformation} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <details>
        <summary className="cursor-pointer text-xs text-muted select-none hover:text-ink">How similarity is computed</summary>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-8 text-xs">
          <div>
            <p className="max-w-xl leading-relaxed text-muted">
              Each component compares one interpretable feature derived from the parsed grammar. Set features use Jaccard
              similarity; count features use normalized numeric closeness. Representation and transformation similarity are
              the unweighted means of their components; overall similarity is the mean of the two.
            </p>
            <table className="mt-3">
              <tbody>
                {measures.map((measure) => (
                  <tr key={measure.label}>
                    <td className="py-0.5 pr-6 capitalize text-muted">{measure.group}</td>
                    <td className="py-0.5 pr-6">{measure.label}</td>
                    <td className="py-0.5 font-mono text-muted">{measure.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pairs.length > 0 && (
            <table className="self-start">
              <thead>
                <tr className="text-muted">
                  <th className="pb-1 pr-4 text-left font-medium">Component</th>
                  {pairs.map(({ a, b }) => (
                    <th key={`${a.id}-${b.id}`} className="pb-1 pl-4 text-right font-medium whitespace-nowrap">
                      {a.name} × {b.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {measures.map((measure, index) => (
                  <tr key={measure.label}>
                    <td className="py-0.5 pr-4">{measure.label}</td>
                    {pairs.map(({ a, b, result }) => (
                      <td key={`${a.id}-${b.id}`} className="py-0.5 pl-4 text-right tabular-nums">
                        {formatScore(result.components[index].score)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </div>
  );
}
