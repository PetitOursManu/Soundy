import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cover } from '../components/Cover';
import {
  IconBluetooth,
  IconCloud,
  IconDown,
  IconDownload,
  IconDownloaded,
  IconMore,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconSpeaker,
} from '../components/Icons';
import { OutputSheet, useOutputLabel } from '../components/OutputSheet';
import { ProgressRing } from '../components/ProgressRing';
import { QueueSheet } from '../components/QueueSheet';
import { Slider } from '../components/Slider';
import { TrackMenu } from '../components/TrackRow';
import { useT } from '../i18n';
import { formatTime } from '../lib/format';
import { hapticClick } from '../lib/haptics';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { FavoriteButton } from '../components/FavoriteButton';

export default function Player() {
  const navigate = useNavigate();
  const track = usePlayer((s) => s.queue[s.index]);
  const { isPlaying, buffering, currentTime, duration, shuffle, repeat, source, queue, index } = usePlayer();
  const { toggle, next, prev, seek, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const downloaded = useDownloads((s) => (track ? !!s.downloaded[track.id] : false));
  const task = useDownloads((s) => s.tasks.find((t) => t.track.id === track?.id));
  const online = useNetwork((s) => s.online);
  const { t } = useT();
  const [preview, setPreview] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'output' | 'queue' | 'menu' | null>(null);
  const output = useOutputLabel(sheet === 'output');

  const close = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  if (!track) {
    return (
      <div className="player">
        <div className="player-inner">
          <div className="player-top">
            <button className="icon-btn" onClick={close} aria-label={t('player.close')}>
              <IconDown />
            </button>
          </div>
          <div className="empty" style={{ marginTop: '20vh' }}>
            <h3>{t('player.nothing')}</h3>
            <p>{t('player.nothingText')}</p>
          </div>
        </div>
      </div>
    );
  }

  const shownTime = preview ?? currentTime;
  const RepeatIcon = repeat === 'one' ? IconRepeatOne : IconRepeat;

  return (
    <div className="player">
      <div className="player-inner">
        <div className="player-top">
          <button className="icon-btn" onClick={close} aria-label={t('player.minimize')}>
            <IconDown />
          </button>
          <div className="label">
            {t('player.nowPlaying')}
            <small>
              {index + 1} / {queue.length}
            </small>
          </div>
          <button className="icon-btn" onClick={() => setSheet('menu')} aria-label={t('player.options')}>
            <IconMore />
          </button>
        </div>

        {/* Platine */}
        <div className="turntable">
          <div className={`vinyl spin ${isPlaying ? '' : 'paused'}`}>
            <Cover imageId={track.imageId} tag={track.imageTag} size={600} alt={track.album} />
            <span className="hole" />
          </div>
          <div className={`tonearm ${isPlaying ? 'on' : ''}`}>
            <span className="base" />
            <span className="arm" />
            <span className="head" />
          </div>
        </div>

        <h2 className="ellipsis">{track.title}</h2>
        <div className="artist ellipsis">
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
        </div>
        <span className={`source-badge ${source === 'local' ? 'local' : ''}`}>
          {source === 'local' ? (
            <>
              <IconDownloaded /> {t('player.local')}
            </>
          ) : (
            <>
              <IconCloud /> {t('player.streaming')}
            </>
          )}
        </span>

        <div className={`bars ${isPlaying && !buffering ? 'on' : ''}`} aria-hidden>
          {[0.1, 0.5, 0.25, 0.8, 0.4, 0.65, 0.15, 0.9, 0.35].map((d, i) => (
            <i key={i} style={{ animationDelay: `-${d}s`, animationDuration: `${0.8 + (i % 3) * 0.25}s` }} />
          ))}
        </div>

        <div className="progress">
          <Slider value={currentTime} max={duration || track.duration} onChange={seek} onPreview={setPreview} label={t('player.position')} />
          <div className="times">
            <span>{formatTime(shownTime)}</span>
            <span>{formatTime(duration || track.duration)}</span>
          </div>
        </div>

        <div className="controls">
          <button className={`icon-btn ${shuffle ? 'active' : ''}`} onClick={() => (hapticClick(), toggleShuffle())} aria-label={t('player.shuffle')} aria-pressed={shuffle}>
            <IconShuffle />
          </button>
          <button className="icon-btn skip" onClick={() => (hapticClick(), prev())} aria-label={t('player.previous')}>
            <IconPrev />
          </button>
          <button className="icon-btn accent main" onClick={() => (hapticClick(), toggle())} aria-label={isPlaying ? t('common.pause') : t('common.play')}>
            {buffering && isPlaying ? <span className="loader" /> : isPlaying ? <IconPause /> : <IconPlay style={{ marginLeft: 4 }} />}
          </button>
          <button className="icon-btn skip" onClick={() => (hapticClick(), next())} aria-label={t('player.next')}>
            <IconNext />
          </button>
          <button
            className={`icon-btn ${repeat !== 'off' ? 'active' : ''}`}
            onClick={() => (hapticClick(), cycleRepeat())}
            aria-label={repeat === 'one' ? t('player.repeatOne') : repeat === 'all' ? t('player.repeatAll') : t('player.repeatOff')}
          >
            <RepeatIcon />
          </button>
        </div>

        <div className="player-actions">
          <FavoriteButton item={track} />
          <button
            className="icon-btn"
            aria-label={downloaded ? t('common.downloaded') : t('player.download')}
            disabled={!downloaded && !task && !online}
            onClick={() => (downloaded || task ? setSheet('menu') : useDownloads.getState().download([track]))}
          >
            {task ? <ProgressRing value={task.progress} /> : downloaded ? <IconDownloaded style={{ color: 'var(--success)' }} /> : <IconDownload />}
          </button>
          <button className={`output-btn ${output.label ? 'connected' : ''}`} onClick={() => setSheet('output')}>
            {output.bluetooth ? <IconBluetooth /> : <IconSpeaker />}
            <span className="ellipsis">{output.label ?? t('player.output')}</span>
          </button>
          <button className="icon-btn" onClick={() => setSheet('queue')} aria-label={t('player.queue')}>
            <IconQueue />
          </button>
        </div>
      </div>

      <OutputSheet open={sheet === 'output'} onClose={() => setSheet(null)} />
      <QueueSheet open={sheet === 'queue'} onClose={() => setSheet(null)} />
      {sheet === 'menu' && <TrackMenu track={track} onClose={() => setSheet(null)} />}
    </div>
  );
}
