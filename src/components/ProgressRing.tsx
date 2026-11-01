export function ProgressRing({ value, size = 22 }: { value: number; size?: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 22 22" style={{ width: size, height: size }} aria-label={`${Math.round(value * 100)} %`}>
      <circle className="bg" cx="11" cy="11" r={r} />
      <circle className="fg" cx="11" cy="11" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.03, value))} />
    </svg>
  );
}
