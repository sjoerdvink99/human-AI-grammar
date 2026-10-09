import type { ParseError } from "@/domain/grammar/types";

export function ParseErrorView({ source, error }: { source: string; error: ParseError }) {
  const line = source.split("\n")[error.line - 1] ?? "";
  const width = Math.max(1, Math.min(error.length, line.length - error.column + 1));
  return (
    <div className="text-[13px]">
      <p className="text-danger">
        <span className="font-mono text-xs">
          {error.line}:{error.column}
        </span>{" "}
        {error.message}
      </p>
      <pre className="mt-1.5 overflow-x-auto font-mono text-xs leading-5 text-muted">
        {line}
        {"\n"}
        <span className="text-danger">{" ".repeat(error.column - 1) + "^".repeat(width)}</span>
      </pre>
    </div>
  );
}
