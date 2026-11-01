export function Empty({ icon, title, text, children }: { icon: React.ReactNode; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">{icon}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div style={{ marginTop: 22 }}>{children}</div>}
    </div>
  );
}
