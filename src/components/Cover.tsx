import { useEffect, useRef, useState } from 'react';
import { getCover } from '../lib/db';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';
import { IconDisc } from './Icons';

interface Props {
  imageId?: string;
  tag?: string;
  size?: number; // taille demandée au serveur (px)
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
}

/**
 * Pochette ronde. Utilise l'image du serveur Emby, ou la copie locale
 * enregistrée lors du téléchargement (hors ligne ou si l'image échoue).
 */
export function Cover({ imageId, tag, size = 300, className = '', alt = '', style }: Props) {
  const client = useAuth((s) => s.client);
  const online = useNetwork((s) => s.online);
  const [src, setSrc] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const objectUrl = useRef<string>();

  const releaseUrl = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = undefined;
  };

  const loadLocal = async (isCancelled: () => boolean = () => false) => {
    if (!imageId) return setFailed(true);
    const blob = await getCover(imageId).catch(() => undefined);
    if (isCancelled()) return;
    if (blob) {
      releaseUrl();
      objectUrl.current = URL.createObjectURL(blob);
      setSrc(objectUrl.current);
    } else setFailed(true);
  };

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setFailed(false);
    if (imageId && online && client) setSrc(client.imageUrl(imageId, tag, size));
    else {
      setSrc(undefined);
      void loadLocal(() => cancelled);
    }
    return () => {
      cancelled = true;
      releaseUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, tag, size, online, client]);

  const onError = () => {
    // L'image distante a échoué : on tente la copie locale
    if (src?.startsWith('blob:')) setFailed(true);
    else void loadLocal();
  };

  return (
    <div className={`cover ${className}`} style={style}>
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={loaded ? 'loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={onError}
        />
      )}
      {(!loaded || failed) && (
        <div className="ph">
          <IconDisc />
        </div>
      )}
    </div>
  );
}
