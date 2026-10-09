// parameters: editable values of the selected part. [human specify] -> parameter_edit (process 3).
import { useEffect, useState } from 'react';
import { SHAPE_DIMENSIONS, SHAPES, type ParameterEdit, type SceneNode, type Shape } from '../shared/scene';

interface Props {
  node: SceneNode | null;
  onEdit: (edit: ParameterEdit) => void;
  disabled: boolean;
}

/** Number field that commits on every valid keystroke / arrow step, with drag-to-scrub on the label. */
function NumField({ label, value, step, min, onCommit, disabled }: { label: string; value: number; step: number; min?: number; onCommit: (v: number) => void; disabled: boolean }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = (s: string) => {
    const v = Number(s);
    if (s.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min)) onCommit(v);
  };
  const scrub = (e: React.PointerEvent) => {
    if (disabled) return;
    const startX = e.clientX;
    const start = value;
    const move = (ev: PointerEvent) => {
      let v = round(start + Math.round((ev.clientX - startX) / 3) * step);
      if (min !== undefined) v = Math.max(min, v);
      onCommit(v);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <label className="num-field">
      <span className="scrub" onPointerDown={scrub} title="Drag to scrub">
        {label}
      </span>
      <input
        type="number"
        step={step}
        min={min}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setText(fmt(value))}
      />
    </label>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const fmt = (v: number) => String(round(v));
const AXES = ['X', 'Y', 'Z'] as const;

export function ParameterPanel({ node, onEdit, disabled }: Props) {
  if (!node) {
    return (
      <div className="panel param-panel">
        <div className="panel-title">Parameters</div>
        <div className="empty">Select a part in the 3D view or the Structure Tree.</div>
      </div>
    );
  }
  const id = node.id;
  const vec = (field: 'position' | 'rotation' | 'scale', step: number, min?: number) => (
    <div className="vec-row">
      <div className="field-label">
        {field}
        {field === 'rotation' ? ' (°)' : ''}
      </div>
      <div className="vec3">
        {AXES.map((a, i) => (
          <NumField key={a} label={a} value={node[field][i]} step={step} min={min} disabled={disabled} onCommit={(v) => onEdit({ nodeId: id, field, axis: i as 0 | 1 | 2, value: v })} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="panel param-panel">
      <div className="panel-title">
        Parameters <span className="muted">· {node.kind === 'group' ? 'subassembly' : 'part'}</span>
      </div>
      <label className="field">
        <span className="field-label">name</span>
        <input type="text" value={node.name} disabled={disabled} onChange={(e) => onEdit({ nodeId: id, field: 'name', value: e.target.value })} />
      </label>
      {node.kind === 'part' && node.geometry && (
        <>
          <div className="field-grid">
            <label className="field">
              <span className="field-label">shape</span>
              <select value={node.geometry.shape} disabled={disabled} onChange={(e) => onEdit({ nodeId: id, field: 'shape', value: e.target.value as Shape })}>
                {SHAPES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">color</span>
              <input type="color" value={node.color} disabled={disabled} onChange={(e) => onEdit({ nodeId: id, field: 'color', value: e.target.value })} />
            </label>
          </div>
          <div className="vec-row">
            <div className="field-label">geometry</div>
            <div className="dims">
              {Object.keys(SHAPE_DIMENSIONS[node.geometry.shape]).map((k) => (
                <NumField
                  key={k}
                  label={k}
                  value={(node.geometry as unknown as Record<string, number>)[k]}
                  step={0.01}
                  min={0}
                  disabled={disabled}
                  onCommit={(v) => onEdit({ nodeId: id, field: 'dimension', key: k, value: v })}
                />
              ))}
            </div>
          </div>
        </>
      )}
      {vec('position', 0.01)}
      {vec('rotation', 1)}
      {vec('scale', 0.01, 0)}
    </div>
  );
}
