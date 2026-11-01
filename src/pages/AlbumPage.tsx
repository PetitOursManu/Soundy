import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Album, Track } from '../api/emby';
import { Cover } from '../components/Cover';
import { Empty } from '../components/Empty';
import { IconAlert, IconBack, IconDownload, IconDownloaded, IconMore, IconPlay, IconPlayNext, IconQueue, IconShuffle, IconTrash, IconX } from '../components/Icons';
import { ProgressRing } from '../components/ProgressRing';
import { MenuItem, Sheet } from '../components/Sheet';
import { TrackWheel } from '../components/TrackWheel';
import { useT } from '../i18n';
import { formatDuration } from '../lib/format';
import { useAuth } from '../store/auth';
import { useDownloadState, useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { FavoriteButton } from '../components/FavoriteButton';

export default function AlbumPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useAuth((s) => s.client);
  const { t, tn } = useT();
  const online = useNetwork((s) => s.online);
  const downloaded = useDownloads((s) => s.downloaded);
  const playQueue = usePlayer((s) => s.playQueue);
  const [album, setAlbum] = useState<Album | null>((location.state as { album?: Album } | null)?.album ?? null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  // Un album peut réunir plusieurs albums Emby (album « éclaté », voir lib/albums.ts)
  const idList = useMemo(() => id.split(',').filter(Boolean), [id]);
  const [allIds, setAllIds] = useState<string[]>(idList);

  // Titres téléchargés de cet album (mode hors ligne)
  const localTracks = useMemo(
    () =>
      Object.values(downloaded)
        .filter((t) => (t.albumId && allIds.includes(t.albumId)) || `single-${t.id}` === id)
        .sort((a, b) => (a.disc ?? 0) - (b.disc ?? 0) || (a.index ?? 0) - (b.index ?? 0)),
    [downloaded, id, allIds],
  );

  useEffect(() => {
    let alive = true;
    setError(null);
    if (!online || !client || id.startsWith('single-')) {
      setTracks(null);
      return;
    }
    (async () => {
      const main = await client.getAlbum(idList[0]);
      // Réunit les morceaux de l'album qu'Emby aurait séparés
      const versions = await client.findAlbumVersions(main);
      const ids = [...idList];
      for (const v of versions) if (!ids.includes(v.id)) ids.push(v.id);
      const t = await client.getTracksOfAlbums(ids);
      if (!alive) return;
      const artists = [main.artist, ...versions.map((v) => v.artist)].filter(Boolean);
      const shortest = artists.reduce((a, b) => (b.length < a.length ? b : a), main.artist);
      setAllIds(ids);
      setAlbum({ ...main, artist: shortest, ids });
      setTracks(t);
    })().catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [id, idList, online, client]);

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
        <button className="icon-btn" onClick={back} aria-label={t('common.back')}>
          <IconBack />
        </button>
        <Empty icon={<IconAlert />} title={t('album.notFound')} text={error} />
      </div>
    );
  }

  return (
    <div className="page page-fill">
      <header className="page-header" style={{ marginBottom: 16 }}>
        <button className="icon-btn" onClick={back} aria-label={t('common.back')}>
          <IconBack />
        </button>
        <span className="muted" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.16em' }}>
          {t('album.label')}
        </span>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label={t('player.options')} disabled={!list.length}>
          <IconMore />
        </button>
      </header>

      <div className="album-head">
        <div className="cover-ring">
          <Cover
            imageId={info?.coverId ?? (info?.imageTag ? info.id : first?.imageId)}
            tag={info?.imageTag ?? first?.imageTag}
            size={400}
            style={{ width: '100%', height: '100%' }}
            alt={info?.title}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="ellipsis">{info?.title ?? '…'}</h1>
          <p className="muted ellipsis" style={{ marginTop: 4, fontSize: 14.5 }}>
            {info?.artist}
          </p>
          {list.length > 0 && (
            <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600 }}>
              {[info?.year, tn('common.tracks', list.length), formatDuration(totalDuration)].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 14, margin: '14px 0 4px' }}>
        <button className="btn accent sm" onClick={() => playQueue(list, 0, { shuffle: false })} disabled={!list.length} style={{ height: 46, flex: 1 }}>
          <IconPlay /> {t('album.play')}
        </button>
        {info && <FavoriteButton item={{ ...info, ids: album?.ids ?? allIds }} />}
        <button className="icon-btn" onClick={() => playQueue(list, 0, { shuffle: true })} disabled={!list.length} aria-label={t('library.shuffle')}>
          <IconShuffle />
        </button>
        <button
          className={`icon-btn ${fullyDownloaded ? 'active' : ''}`}
          onClick={toggleDownload}
          disabled={!list.length || (!online && !fullyDownloaded)}
          aria-label={fullyDownloaded ? t('album.downloaded') : dl.pending ? t('album.cancelDownload') : t('album.download')}
          title={dl.done > 0 && dl.done < dl.total && !dl.pending ? t('album.partial', { done: dl.done, total: dl.total }) : undefined}
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

      {list.length > 0 ? (
        <div className="wheel-area">
          <TrackWheel tracks={list} mode="album" multiDisc={multiDisc} label={t('album.trackList')} onPlay={(i) => playQueue(list, i, { shuffle: false })} />
        </div>
      ) : (
        loading && (
          <div className="wheel-area" aria-hidden>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <span className="loader" style={{ color: 'var(--text-3)' }} />
            </div>
          </div>
        )
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={info?.title} description={info?.artist}>
        <MenuItem
          icon={<IconPlayNext />}
          label={t('album.playNext')}
          onClick={() => {
            usePlayer.getState().addNext(list);
            setMenu(false);
          }}
        />
        <MenuItem
          icon={<IconQueue />}
          label={t('album.addToQueue')}
          onClick={() => {
            usePlayer.getState().addToQueue(list);
            setMenu(false);
          }}
        />
        {dl.pending > 0 ? (
          <MenuItem
            icon={<IconX />}
            label={t('album.cancelDownloads')}
            onClick={() => {
              list.forEach((t) => cancel(t.id));
              setMenu(false);
            }}
          />
        ) : (
          !fullyDownloaded && (
            <MenuItem
              icon={<IconDownload />}
              label={t('album.download')}
              hint={t('album.downloadHint')}
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
            label={t('album.removeFromDevice')}
            hint={tn('album.downloadedCount', dl.done)}
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
