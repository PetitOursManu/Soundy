import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Album, Track } from '../api/emby';
import { Cover } from '../components/Cover';
import { Empty } from '../components/Empty';
import { IconAlert, IconBack, IconDownload, IconDownloaded, IconMore, IconPlay, IconPlayNext, IconQueue, IconShuffle, IconTrash, IconX } from '../components/Icons';
import { ProgressRing } from '../components/ProgressRing';
import { MenuItem, Sheet } from '../components/Sheet';
import { TrackRow } from '../components/TrackRow';
import { formatDuration, plural } from '../lib/format';
import { useAuth } from '../store/auth';
import { useDownloadState, useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';

export default function AlbumPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useAuth((s) => s.client);
  const online = useNetwork((s) => s.online);
  const downloaded = useDownloads((s) => s.downloaded);
  const playQueue = usePlayer((s) => s.playQueue);
  const [album, setAlbum] = useState<Album | null>((location.state as { album?: Album } | null)?.album ?? null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  // Titres téléchargés de cet album (mode hors ligne)
  const localTracks = useMemo(
    () =>
      Object.values(downloaded)
        .filter((t) => t.albumId === id || `single-${t.id}` === id)
        .sort((a, b) => (a.disc ?? 0) - (b.disc ?? 0) || (a.index ?? 0) - (b.index ?? 0)),
    [downloaded, id],
  );

  useEffect(() => {
    let alive = true;
    setError(null);
    if (!online || !client || id.startsWith('single-')) {
      setTracks(null);
      return;
    }
    Promise.all([client.getAlbum(id), client.getAlbumTracks(id)])
      .then(([a, t]) => {
        if (!alive) return;
        setAlbum(a);
        setTracks(t);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [id, online, client]);

  const list: Track[] = tracks ?? (online && !id.startsWith('single-') ? [] : localTracks);
  const first = list[0] ?? localTracks[0];
  const info: Album | null =
    album ??
    (first
      ? { id, title: first.album || first.title, artist: first.albumArtist || first.artist, imageTag: first.imageTag, coverId: first.imageId }
      : null);
  const ids = useMemo(() => list.map((t) => t.id), [list]);
  const dl = useDownloadState(ids);
  const totalDuration = list.reduce((s, t) => s + t.duration, 0);
  const multiDisc = new Set(list.map((t) => t.disc ?? 1)).size > 1;
  const loading = online && !tracks && !error && !id.startsWith('single-');

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
  const fullyDownloaded = dl.total > 0 && dl.done === dl.total;
  const { download, remove, cancel } = useDownloads.getState();

  const toggleDownload = () => {
    if (dl.pending) list.forEach((t) => cancel(t.id));
    else if (fullyDownloaded) setMenu(true);
    else download(list);
  };

  if (error && !localTracks.length) {
    return (
      <div className="page">
        <button className="icon-btn" onClick={back} aria-label="Retour">
          <IconBack />
        </button>
        <Empty icon={<IconAlert />} title="Album introuvable" text={error} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" onClick={back} aria-label="Retour">
          <IconBack />
        </button>
        <span className="muted" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.16em' }}>
          ALBUM
        </span>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Options" disabled={!list.length}>
          <IconMore />
        </button>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div className="cover-ring" style={{ width: 'min(62vw, 250px)', aspectRatio: '1', padding: 12, boxShadow: 'var(--neu-xl)' }}>
          <Cover
            imageId={info?.coverId ?? (info?.imageTag ? info.id : first?.imageId)}
            tag={info?.imageTag ?? first?.imageTag}
            size={600}
            style={{ width: '100%', height: '100%' }}
            alt={info?.title}
          />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginTop: 26, letterSpacing: '-0.02em' }}>{info?.title ?? '…'}</h1>
        <p className="muted" style={{ marginTop: 6, fontSize: 15 }}>
          {info?.artist}
        </p>
        {list.length > 0 && (
          <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>
            {[info?.year, plural(list.length, 'titre'), formatDuration(totalDuration)].filter(Boolean).join(' · ')}
          </p>
        )}

        <div className="row" style={{ marginTop: 24, gap: 16, justifyContent: 'center' }}>
          <button className="icon-btn" onClick={() => playQueue(list, 0, { shuffle: true })} disabled={!list.length} aria-label="Lecture aléatoire">
            <IconShuffle />
          </button>
          <button className="btn accent" onClick={() => playQueue(list, 0, { shuffle: false })} disabled={!list.length} style={{ minWidth: 150 }}>
            <IconPlay /> Lire
          </button>
          <button
            className={`icon-btn ${fullyDownloaded ? 'active' : ''}`}
            onClick={toggleDownload}
            disabled={!list.length || (!online && !fullyDownloaded)}
            aria-label={fullyDownloaded ? 'Album téléchargé' : dl.pending ? 'Annuler le téléchargement' : "Télécharger l'album"}
          >
            {dl.pending ? (
              <ProgressRing value={dl.progress} />
            ) : fullyDownloaded ? (
              <IconDownloaded style={{ color: 'var(--success)' }} />
            ) : (
              <IconDownload />
            )}
          </button>
        </div>
        {dl.done > 0 && dl.done < dl.total && !dl.pending && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {dl.done} / {dl.total} titres disponibles hors ligne
          </p>
        )}
      </div>

      <div className="track-list" style={{ marginTop: 30 }}>
        {loading &&
          Array.from({ length: album?.trackCount ?? 8 }, (_, i) => (
            <div key={i} className="track-row">
              <span className="num">{i + 1}</span>
              <div className="info">
                <div className="skeleton" style={{ height: 12, width: '55%', marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 10, width: '30%' }} />
              </div>
            </div>
          ))}
        {list.map((t, i) => (
          <div key={t.id}>
            {multiDisc && (i === 0 || (list[i - 1].disc ?? 1) !== (t.disc ?? 1)) && (
              <div className="section-title" style={{ marginTop: i === 0 ? 0 : 20 }}>
                Disque {t.disc ?? 1}
              </div>
            )}
            <TrackRow track={t} number={t.index ?? i + 1} showCover={false} onPlay={() => playQueue(list, i, { shuffle: false })} />
          </div>
        ))}
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={info?.title} description={info?.artist}>
        <MenuItem
          icon={<IconPlayNext />}
          label="Lire ensuite"
          onClick={() => {
            usePlayer.getState().addNext(list);
            setMenu(false);
          }}
        />
        <MenuItem
          icon={<IconQueue />}
          label="Ajouter à la file d'attente"
          onClick={() => {
            usePlayer.getState().addToQueue(list);
            setMenu(false);
          }}
        />
        {dl.pending > 0 ? (
          <MenuItem
            icon={<IconX />}
            label="Annuler les téléchargements"
            onClick={() => {
              list.forEach((t) => cancel(t.id));
              setMenu(false);
            }}
          />
        ) : (
          !fullyDownloaded && (
            <MenuItem
              icon={<IconDownload />}
              label="Télécharger l'album"
              hint="Lecture hors ligne, prioritaire sur le streaming"
              disabled={!online}
              onClick={() => {
                download(list);
                setMenu(false);
              }}
            />
          )
        )}
        {dl.done > 0 && (
          <MenuItem
            icon={<IconTrash />}
            label="Supprimer de l'appareil"
            hint={`${dl.done} titre${dl.done > 1 ? 's' : ''} téléchargé${dl.done > 1 ? 's' : ''}`}
            danger
            onClick={() => {
              void remove(ids.filter((x) => downloaded[x]));
              setMenu(false);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
