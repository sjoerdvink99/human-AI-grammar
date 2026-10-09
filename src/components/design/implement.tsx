"use client";

import { Check, Copy, Download, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { designParam, specFileName, type DesignSpec } from "@/domain/design/spec";
import type { SystemEntry } from "@/domain/systems/types";

const marketplace = "sjoerdvink99/human-AI-grammar";

const designLink = (encoded: string) => `${window.location.origin}${window.location.pathname}#${designParam}=${encoded}`;

function CopyButton({
  label,
  copied,
  disabled,
  primary,
  onCopy,
}: {
  label: string;
  copied: boolean;
  disabled: boolean;
  primary?: boolean;
  onCopy: () => void;
}) {
  return (
    <Button variant={primary ? "primary" : "secondary"} disabled={disabled} onClick={onCopy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label}
    </Button>
  );
}

function download(spec: DesignSpec) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(spec, null, 2)}\n`], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: specFileName(spec) });
  link.click();
  URL.revokeObjectURL(url);
}

export function Implement({
  spec,
  encoded,
  complete,
  entries,
  onRemoveReference,
}: {
  spec: DesignSpec;
  encoded: string | null;
  complete: boolean;
  entries: SystemEntry[];
  onRemoveReference: (citationKey: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const ready = complete && encoded !== null;
  const names = new Map(entries.map((entry) => [entry.paper.citationKey, entry.name]));

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Section title="Implement" aside="Claude Code plugin">
      {spec.references.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 text-muted">References</span>
          {spec.references.map((key) => (
            <span key={key} className="inline-flex items-center gap-1 rounded-sm border border-line bg-wash py-px pr-0.5 pl-1.5 leading-5">
              {names.get(key) ?? key}
              <button type="button" onClick={() => onRemoveReference(key)} aria-label={`Remove ${key}`} className="rounded p-0.5 text-faint hover:text-ink">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="max-w-3xl text-[13px] text-muted">
        Install the plugin once, then run the command in the repository where the system should live. Claude reads the design and the
        referenced papers, maps each representation and transformation onto your code, and confirms a plan before implementing it.
      </p>
      <pre className="mt-3 overflow-x-auto rounded border border-line bg-wash px-3 py-2.5 font-mono text-xs leading-6">
        <span className="text-faint">/plugin marketplace add </span>
        {marketplace}
        {"\n"}
        <span className="text-faint">/plugin install </span>human-ai@human-ai-grammar
        {"\n"}
        <span className="text-faint">/human-ai:implement </span>&lt;design link or file&gt;
      </pre>
      <div className="mt-3 flex items-center gap-2">
        <CopyButton
          label="Copy command"
          primary
          copied={copied === "command"}
          disabled={!ready}
          onCopy={() => copy("command", `/human-ai:implement ${spec.images.length ? specFileName(spec) : designLink(encoded ?? "")}`)}
        />
        <CopyButton label="Copy link" copied={copied === "link"} disabled={!ready} onCopy={() => copy("link", designLink(encoded ?? ""))} />
        <Button variant="ghost" disabled={!ready} onClick={() => download(spec)}>
          <Download className="size-3.5" />
          design.json
        </Button>
        {!ready && <span className="text-xs text-faint">Every process needs a valid expression</span>}
        {ready && spec.images.length > 0 && <span className="text-xs text-faint">Images travel in the file: save {specFileName(spec)} in the repository first</span>}
      </div>
    </Section>
  );
}
