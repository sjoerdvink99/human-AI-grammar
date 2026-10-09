"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function Citation({ bibtex }: { bibtex: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(bibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative rounded border border-line bg-wash">
      <pre className="overflow-x-auto px-3 py-2.5 pr-24 font-mono text-xs leading-5">{bibtex}</pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 inline-flex h-7 items-center gap-1.5 rounded border border-line-strong bg-white px-2 text-xs font-medium text-muted hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-tool" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
