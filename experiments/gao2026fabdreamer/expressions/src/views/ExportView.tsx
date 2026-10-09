import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { ViewProps } from '../App.tsx';

interface LayerFile {
  layerId: string;
  name: string;
  depth: number;
  fileBase: string;
  svg: string;
  png: string;
  pieces: number;
}

/** Process 11: tool translate → per-layer SVG/PNG → human picks format → tool composes the zip. */
export function ExportView({ state }: ViewProps) {
  const [files, setFiles] = useState<LayerFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<'svg' | 'png' | 'both'>('both');
  useEffect(() => {
    api<LayerFile[]>('/export/layers').then(setFiles, (e) => setError(e.message));
  }, [state.canvas?.version, state.materialSettings]);
  const errors = state.constraintIssues.filter((i) => i.severity === 'error').length;
  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <h2>Cut files</h2>
          <div className="row">
            {(['svg', 'png', 'both'] as const).map((c) => (
              <label key={c} className="radio">
                <input type="radio" checked={choice === c} onChange={() => setChoice(c)} /> {c === 'both' ? 'SVG + PNG' : c.toUpperCase()}
              </label>
            ))}
            <a className="button primary" href={`/api/export/zip?choice=${choice}`} download>
              Download zip
            </a>
          </div>
        </div>
        <p className="small muted">
          {state.materialSettings.material}, {state.materialSettings.thicknessMm} mm sheets, artwork {state.materialSettings.artworkWidthMm} mm wide. SVGs are in millimetres: red hairlines are cuts, the blue rectangle is the frame.
          {errors > 0 && <strong className="bad"> The last check found {errors} blocking issue(s).</strong>}
        </p>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="filegrid">
        {files?.map((f) => (
          <div className="card" key={f.layerId}>
            <h3>
              {f.fileBase} <span className="muted small">· {f.pieces} pieces</span>
            </h3>
            <div className="pair">
              <figure>
                <div className="svgbox" dangerouslySetInnerHTML={{ __html: f.svg.replace(/<\?xml[^>]*>/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, '') }} />
                <figcaption>{f.fileBase}.svg</figcaption>
              </figure>
              <figure>
                <img src={f.png} alt="" className="checker" />
                <figcaption>{f.fileBase}.png</figcaption>
              </figure>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
