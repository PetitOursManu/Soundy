import { useRef } from 'react';
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
  const { toggle, next, stop } = usePlayer.getState();
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; t: number; dy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  if (!track) return null;
  const open = () => navigate('/player');

  // Glisser vers le bas (titre en pause) : le mini lecteur disparaît et la lecture est arrêtée
  const setPos = (dy: number, animated: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animated ? 'transform 0.25s var(--ease), opacity 0.25s var(--ease)' : 'none';
    el.style.transform = dy ? `translate(-50%, ${dy}px)` : '';
    el.style.opacity = dy ? String(Math.max(0, 1 - dy / 160)) : '';
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (usePlayer.getState().isPlaying) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (dy < 6) {
        if (dy < -10) drag.current = null; // geste vers le haut : on ignore
        return;
      }
      d.moved = true;
      ref.current?.setPointerCapture(e.pointerId);
    }
    d.dy = Math.max(0, dy);
    setPos(d.dy, false);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.moved) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const speed = d.dy / Math.max(1, performance.now() - d.t); // px / ms
    if (d.dy > 60 || speed > 0.6) {
      hapticClick();
      setPos(220, true);
      setTimeout(() => {
        stop();
        setPos(0, false);
      }, 230);
    } else {
      setPos(0, true);
    }
  };

  return (
    <div
      ref={ref}
      className={`mini-player ${isPlaying ? '' : 'dismissable'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
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
