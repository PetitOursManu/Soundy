import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { Album } from '../api/emby';
import { Cover } from './Cover';
import { IconDownloaded } from './Icons';

export const AlbumCard = memo(function AlbumCard({ album, downloaded }: { album: Album; downloaded?: boolean }) {
  return (
    <Link to={`/album/${album.id}`} className="album-card" state={{ album }}>
      {downloaded && (
        <span className="dl-badge" title="Téléchargé">
          <IconDownloaded />
        </span>
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
