import { useMemo, useState } from "react";
import type { WebCode } from "../../../shared/types.ts";
import { toPreviewDocument } from "../../../shared/preview.ts";

/** Process 4: code_3 → [tool_5 translate] → preview_1 (live, interactive iframe). */
export function PreviewPanel({ code, label }: { code: WebCode; label: string }) {
  const [nonce, setNonce] = useState(0);
  const doc = useMemo(() => toPreviewDocument(code), [code]);
  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="small muted">Previewing: {label}</span>
        <span className="spacer" />
        <button onClick={() => setNonce(nonce + 1)}>Reload</button>
        <button onClick={() => window.open(URL.createObjectURL(new Blob([doc], { type: "text/html" })), "_blank")}>Open in new tab</button>
      </div>
      <iframe key={nonce} title="Webpage preview" sandbox="allow-scripts allow-forms allow-modals" srcDoc={doc} />
    </div>
  );
}
