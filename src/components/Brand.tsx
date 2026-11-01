/** Logo Soundy : le « S » + le nom écrit dans la police de l'application. */
export function Brand({ size = 44, withName = true }: { size?: number; withName?: boolean }) {
  return (
    <div className="brand" style={{ ['--brand-size' as string]: `${size}px` }}>
      <img src="./logo-s.png" alt={withName ? '' : 'Soundy'} width={size} height={size} draggable={false} />
      {withName && <span>Soundy</span>}
    </div>
  );
}
