// parameters (artifact record) for selected_node, with inputs that produce
// parameter_edit (instruction record) — process 3, human specify.
import { useEffect, useRef, useState } from 'react';
import type { AttrSpec, AttrValue, NodeParams } from '../shared/scene';
import { ATTR_SPECS } from '../shared/scene';
import type { ParameterEdit } from '../shared/edits';

function NumberField({
  value, step = 0.1, min, onCommit, label,
}: { value: number; step?: number; min?: number; onCommit: (v: number) => void; label?: string }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const clamp = (v: number) => (min !== undefined ? Math.max(min, v) : v);
  const commit = (s: string) => {
    const v = parseFloat(s);
    if (Number.isFinite(v)) onCommit(clamp(Math.round(v * 1000) / 1000));
  };

  // drag the label horizontally to scrub the value
  const startScrub = (e: React.PointerEvent) => {
    const x0 = e.clientX;
    const v0 = value;
    const move = (ev: PointerEvent) => {
      const v = clamp(Math.round((v0 + ((ev.clientX - x0) / 4) * step) * 1000) / 1000);
      setText(String(v));
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
      {label && <span className="scrub" onPointerDown={startScrub} title="Drag to change">{label}</span>}
      <input
        type="number"
        step={step}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => { focused.current = false; setText(String(value)); }}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
      />
    </label>
  );
}

const AXES = ['x', 'y', 'z'];
const AXES2 = ['w', 'd'];

function Field({ k, spec, value, onEdit }: { k: string; spec: AttrSpec; value: AttrValue; onEdit: (v: AttrValue) => void }) {
  if (spec.kind === 'vec3' || spec.kind === 'vec2') {
    const arr = value as number[];
    const names = spec.kind === 'vec3' ? (k === 'size' ? ['w', 'h', 'd'] : AXES) : AXES2;
    return (
      <div className="vec">
        {arr.map((v, i) => (
          <NumberField
            key={i}
            label={names[i]}
            value={v}
            step={spec.step}
            min={spec.min}
            onCommit={(nv) => onEdit(arr.map((x, j) => (j === i ? nv : x)))}
          />
        ))}
      </div>
    );
  }
  if (spec.kind === 'number') {
    return <NumberField label="↔" value={value as number} step={spec.step} min={spec.min} onCommit={onEdit} />;
  }
  if (spec.kind === 'color') {
    return (
      <div className="color-field">
        <input type="color" value={value as string} onChange={(e) => onEdit(e.target.value)} />
        <code>{value as string}</code>
      </div>
    );
  }
  return <input value={value as string} onChange={(e) => onEdit(e.target.value)} />;
}

interface Props {
  params: NodeParams | undefined;
  disabled: boolean;
  onEdit: (edit: ParameterEdit) => void;
}

export function ParameterPanel({ params, disabled, onEdit }: Props) {
  const [name, setName] = useState('');
  useEffect(() => setName(params?.name ?? ''), [params?.id, params?.name]);

  if (!params) return <div className="empty">Select a part in the tree, the 3D view or the code to edit its parameters.</div>;
  const specs = ATTR_SPECS[params.type];
  const commitName = () => {
    if (name.trim() && name !== params.name) onEdit({ nodeId: params.id, key: 'name', value: name.trim() });
  };
  return (
    <fieldset className="params" disabled={disabled}>
      <div className="param-row">
        <span className="pk">name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
        />
      </div>
      {Object.entries(specs).map(([k, spec]) => (
        <div className="param-row" key={k}>
          <span className="pk">{k}</span>
          <Field k={k} spec={spec} value={params.attrs[k]} onEdit={(v) => onEdit({ nodeId: params.id, key: k, value: v })} />
        </div>
      ))}
    </fieldset>
  );
}
