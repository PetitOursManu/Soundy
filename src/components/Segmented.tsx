interface Option<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}

/** Interrupteur neumorphique à plusieurs positions. */
export function Segmented<T extends string>({ options, value, onChange, label }: Props<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      <span
        className="thumb"
        style={{ width: `calc((100% - 12px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
          {!!o.count && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
