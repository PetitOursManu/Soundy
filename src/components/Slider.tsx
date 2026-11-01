import { useRef, useState } from 'react';

interface Props {
  value: number;
  max: number;
  onChange: (v: number) => void;
  onPreview?: (v: number | null) => void;
  label?: string;
}

/** Curseur neumorphique (tactile + clavier). */
export function Slider({ value, max, onChange, onPreview, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return (Math.min(1, Math.max(0, (clientX - r.left) / r.width)) || 0) * max;
  };

  const update = (v: number | null) => {
    setDrag(v);
    onPreview?.(v);
  };

  return (
    <div
      ref={ref}
      className="slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      onPointerDown={(e) => {
        if (!max) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(valueAt(e.clientX));
      }}
      onPointerMove={(e) => drag !== null && update(valueAt(e.clientX))}
      onPointerUp={(e) => {
        if (drag === null) return;
        onChange(valueAt(e.clientX));
        update(null);
      }}
      onPointerCancel={() => update(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onChange(Math.min(max, value + 5));
        if (e.key === 'ArrowLeft') onChange(Math.max(0, value - 5));
      }}
    >
      <div className="track" />
      <div className="fill" style={{ width: `${pct}%` }} />
      <div className="knob" style={{ left: `${pct}%` }} />
    </div>
  );
}
