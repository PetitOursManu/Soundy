import { memo, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Album } from '../api/emby';
import { albumPath } from '../lib/albums';
import { hapticClick, hapticHeavy } from '../lib/haptics';
import { useT } from '../i18n';
import { Cover } from './Cover';
import { IconCheck, IconDownloaded } from './Icons';

interface Props {
  album: Album;
  downloaded?: boolean;
  /** Mode sélection : un appui coche / décoche l'album au lieu de l'ouvrir. */
  selecting?: boolean;
  selected?: boolean;
  onToggle?: (album: Album) => void;
  /** Appui long (mobile) ou clic droit : entre en mode sélection. */
  onLongPress?: (album: Album) => void;
}

export const AlbumCard = memo(function AlbumCard({ album, downloaded, selecting, selected, onToggle, onLongPress }: Props) {
  const { t } = useT();
  const timer = useRef<number>();
  const longPressed = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  const cancel = () => clearTimeout(timer.current);

  return (
    <Link
      to={albumPath(album)}
      className={`album-card ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`}
      state={{ album }}
      aria-pressed={selecting ? selected : undefined}
      onClick={(e) => {
        if (longPressed.current) {
          e.preventDefault();
          longPressed.current = false;
          return;
        }
        if (selecting) {
          e.preventDefault();
          hapticClick();
          onToggle?.(album);
        }
      }}
      onContextMenu={(e) => {
        if (!onLongPress) return;
        e.preventDefault();
        if (selecting) onToggle?.(album);
        else onLongPress(album);
      }}
      onPointerDown={(e) => {
        if (!onLongPress || e.pointerType === 'mouse') return;
        start.current = { x: e.clientX, y: e.clientY };
        longPressed.current = false;
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          hapticHeavy();
          if (selecting) onToggle?.(album);
          else onLongPress(album);
        }, 500);
      }}
      onPointerMove={(e) => {
        if (Math.abs(e.clientX - start.current.x) + Math.abs(e.clientY - start.current.y) > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
    >
      {selecting ? (
        <span className="select-dot" aria-hidden>
          {selected && <IconCheck />}
        </span>
      ) : (
        downloaded && (
          <span className="dl-badge" title={t('common.downloaded')}>
            <IconDownloaded />
          </span>
        )
      )}
      <div className="cover-ring">
        <Cover imageId={album.coverId ?? (album.imageTag ? album.id : undefined)} tag={album.imageTag} alt={album.title} />
      </div>
      <div className="title ellipsis">{album.title}</div>
      <div className="sub ellipsis">{album.artist}</div>
    </Link>
  );
});

export function AlbumCardSkeleton() {
  return (
    <div className="album-card" aria-hidden>
      <div className="cover-ring">
        <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
      </div>
      <div className="skeleton" style={{ height: 12, width: '70%', margin: '4px auto 8px' }} />
      <div className="skeleton" style={{ height: 10, width: '45%', margin: '0 auto' }} />
    </div>
  );
}
