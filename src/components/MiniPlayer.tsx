import { useNavigate } from 'react-router-dom';
import { hapticClick } from '../lib/haptics';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { IconNext, IconPause, IconPlay } from './Icons';
import { useT } from '../i18n';

export function MiniPlayer() {
  const navigate = useNavigate();
  const track = usePlayer((s) => s.queue[s.index]);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const buffering = usePlayer((s) => s.buffering);
  const pct = usePlayer((s) => (s.duration ? (s.currentTime / s.duration) * 100 : 0));
  const { toggle, next } = usePlayer.getState();
  const { t } = useT();

  if (!track) return null;
  const open = () => navigate('/player');

  return (
    <div className="mini-player">
      <div onClick={open} style={{ cursor: 'pointer' }}>
        <Cover imageId={track.imageId} tag={track.imageTag} size={120} className={`spin ${isPlaying ? '' : 'paused'}`} />
      </div>
      <div className="meta" onClick={open} role="button" aria-label={t('player.open')}>
        <div className="t ellipsis">{track.title}</div>
        <div className="s ellipsis">{track.artist}</div>
      </div>
      <button className="icon-btn accent" onClick={() => (hapticClick(), toggle())} aria-label={isPlaying ? t('common.pause') : t('common.play')}>
        {buffering && isPlaying ? <span className="loader" style={{ width: 18, height: 18 }} /> : isPlaying ? <IconPause /> : <IconPlay style={{ marginLeft: 2 }} />}
      </button>
      <button className="icon-btn flat" onClick={() => (hapticClick(), next())} aria-label={t('player.next')}>
        <IconNext />
      </button>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
