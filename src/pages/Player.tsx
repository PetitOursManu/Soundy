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
import { formatTime } from '../lib/format';
import { hapticClick } from '../lib/haptics';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';

export default function Player() {
  const navigate = useNavigate();
  const track = usePlayer((s) => s.queue[s.index]);
  const { isPlaying, buffering, currentTime, duration, shuffle, repeat, source, queue, index } = usePlayer();
  const { toggle, next, prev, seek, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const downloaded = useDownloads((s) => (track ? !!s.downloaded[track.id] : false));
  const task = useDownloads((s) => s.tasks.find((t) => t.track.id === track?.id));
  const online = useNetwork((s) => s.online);
  const [preview, setPreview] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'output' | 'queue' | 'menu' | null>(null);
  const output = useOutputLabel(sheet === 'output');

  const close = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  if (!track) {
    return (
      <div className="player">
        <div className="player-inner">
          <div className="player-top">
            <button className="icon-btn" onClick={close} aria-label="Fermer">
              <IconDown />
            </button>
          </div>
          <div className="empty" style={{ marginTop: '20vh' }}>
            <h3>Aucune lecture en cours</h3>
            <p>Choisissez un album ou un titre dans votre bibliothèque.</p>
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
          <button className="icon-btn" onClick={close} aria-label="Réduire le lecteur">
            <IconDown />
          </button>
          <div className="label">
            En lecture
            <small>
              {index + 1} / {queue.length}
            </small>
          </div>
          <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="Options">
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
              <IconDownloaded /> Lecture locale
            </>
          ) : (
            <>
              <IconCloud /> Streaming
            </>
          )}
        </span>

        <div className={`bars ${isPlaying && !buffering ? 'on' : ''}`} aria-hidden>
          {[0.1, 0.5, 0.25, 0.8, 0.4, 0.65, 0.15, 0.9, 0.35].map((d, i) => (
            <i key={i} style={{ animationDelay: `-${d}s`, animationDuration: `${0.8 + (i % 3) * 0.25}s` }} />
          ))}
        </div>

        <div className="progress">
          <Slider value={currentTime} max={duration || track.duration} onChange={seek} onPreview={setPreview} label="Position de lecture" />
          <div className="times">
            <span>{formatTime(shownTime)}</span>
            <span>{formatTime(duration || track.duration)}</span>
          </div>
        </div>

        <div className="controls">
          <button className={`icon-btn ${shuffle ? 'active' : ''}`} onClick={() => (hapticClick(), toggleShuffle())} aria-label="Aléatoire" aria-pressed={shuffle}>
            <IconShuffle />
          </button>
          <button className="icon-btn skip" onClick={() => (hapticClick(), prev())} aria-label="Précédent">
            <IconPrev />
          </button>
          <button className="icon-btn accent main" onClick={() => (hapticClick(), toggle())} aria-label={isPlaying ? 'Pause' : 'Lecture'}>
            {buffering && isPlaying ? <span className="loader" /> : isPlaying ? <IconPause /> : <IconPlay style={{ marginLeft: 4 }} />}
          </button>
          <button className="icon-btn skip" onClick={() => (hapticClick(), next())} aria-label="Suivant">
            <IconNext />
          </button>
          <button
            className={`icon-btn ${repeat !== 'off' ? 'active' : ''}`}
            onClick={() => (hapticClick(), cycleRepeat())}
            aria-label={repeat === 'one' ? 'Répéter le titre' : repeat === 'all' ? 'Répéter la file' : 'Répétition désactivée'}
          >
            <RepeatIcon />
          </button>
        </div>

        <div className="player-actions">
          <button
            className="icon-btn"
            aria-label={downloaded ? 'Téléchargé' : 'Télécharger'}
            disabled={!downloaded && !task && !online}
            onClick={() => (downloaded || task ? setSheet('menu') : useDownloads.getState().download([track]))}
          >
            {task ? <ProgressRing value={task.progress} /> : downloaded ? <IconDownloaded style={{ color: 'var(--success)' }} /> : <IconDownload />}
          </button>
          <button className={`output-btn ${output.label ? 'connected' : ''}`} onClick={() => setSheet('output')}>
            {output.bluetooth ? <IconBluetooth /> : <IconSpeaker />}
            <span className="ellipsis">{output.label ?? 'Sortie audio'}</span>
          </button>
          <button className="icon-btn" onClick={() => setSheet('queue')} aria-label="File d'attente">
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
