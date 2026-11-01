import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Track } from '../api/emby';
import { formatTime } from '../lib/format';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { IconDisc, IconDownload, IconDownloaded, IconMore, IconPause, IconPlay, IconPlayNext, IconQueue, IconTrash, IconX } from './Icons';
import { ProgressRing } from './ProgressRing';
import { MenuItem, Sheet } from './Sheet';
import { useT } from '../i18n';

interface Props {
  track: Track;
  number?: number; // affiché à la place de la pochette (vue album)
  showCover?: boolean;
  showAlbum?: boolean;
  onPlay: () => void;
}

export const TrackRow = memo(function TrackRow({ track, number, showCover = true, showAlbum = false, onPlay }: Props) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const toggle = usePlayer((s) => s.toggle);
  const downloaded = useDownloads((s) => !!s.downloaded[track.id]);
  const task = useDownloads((s) => s.tasks.find((t) => t.track.id === track.id));
  const online = useNetwork((s) => s.online);
  const [menu, setMenu] = useState(false);
  const { t } = useT();
  const unavailable = !online && !downloaded;

  const play = () => {
    if (unavailable) return;
    if (isCurrent) toggle();
    else onPlay();
  };

  return (
    <>
      <div
        className={`track-row ${isCurrent ? 'active' : ''} ${unavailable ? 'unavailable' : ''}`}
        onClick={play}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
      >
        {showCover ? (
          <Cover imageId={track.imageId} tag={track.imageTag} size={120} style={{ width: 50, height: 50 }} />
        ) : (
          <span className="num">
            {isCurrent ? (
              <span className={`eq ${isPlaying ? '' : 'paused'}`} style={{ color: 'var(--accent)' }}>
                <i />
                <i />
                <i />
              </span>
            ) : (
              number ?? ''
            )}
          </span>
        )}
        <div className="info">
          <div className="t ellipsis">{track.title}</div>
          <div className="s">
            {task ? (
              <ProgressRing value={task.progress} size={13} />
            ) : (
              downloaded && <IconDownloaded aria-label={t('common.downloaded')} />
            )}
            <span className="ellipsis">{showAlbum && track.album ? `${track.artist} · ${track.album}` : track.artist}</span>
          </div>
        </div>
        <span className="dur">{formatTime(track.duration)}</span>
        <button
          className="icon-btn sm flat"
          aria-label={t('common.more')}
          onClick={(e) => {
            e.stopPropagation();
            setMenu(true);
          }}
        >
          <IconMore />
        </button>
        <button
          className="play"
          aria-label={isCurrent && isPlaying ? t('common.pause') : t('common.play')}
          onClick={(e) => {
            e.stopPropagation();
            play();
          }}
        >
          {isCurrent && isPlaying ? <IconPause /> : <IconPlay style={{ marginLeft: 2 }} />}
        </button>
      </div>
      {menu && <TrackMenu track={track} onClose={() => setMenu(false)} />}
    </>
  );
});

export function TrackMenu({ track, onClose }: { track: Track; onClose: () => void }) {
  const navigate = useNavigate();
  const { addNext, addToQueue } = usePlayer.getState();
  const downloaded = useDownloads((s) => !!s.downloaded[track.id]);
  const task = useDownloads((s) => s.tasks.find((t) => t.track.id === track.id));
  const { download, remove, cancel } = useDownloads.getState();
  const online = useNetwork((s) => s.online);
  const { t } = useT();
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={track.title} description={`${track.artist}${track.album ? ` · ${track.album}` : ''}`}>
      <MenuItem icon={<IconPlayNext />} label={t('track.playNext')} onClick={run(() => addNext([track]))} />
      <MenuItem icon={<IconQueue />} label={t('track.addToQueue')} onClick={run(() => addToQueue([track]))} />
      {downloaded ? (
        <MenuItem icon={<IconTrash />} label={t('track.remove')} danger onClick={run(() => void remove([track.id]))} />
      ) : task ? (
        <MenuItem icon={<IconX />} label={t('track.cancelDownload')} onClick={run(() => cancel(track.id))} />
      ) : (
        <MenuItem
          icon={<IconDownload />}
          label={t('track.download')}
          hint={t('track.downloadHint')}
          disabled={!online}
          onClick={run(() => download([track]))}
        />
      )}
      {track.albumId && (
        <MenuItem icon={<IconDisc />} label={t('track.goToAlbum')} onClick={run(() => navigate(`/album/${track.albumId}`))} />
      )}
    </Sheet>
  );
}
