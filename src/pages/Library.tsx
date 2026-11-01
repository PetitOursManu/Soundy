import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Album, SortKey, Track } from '../api/emby';
import { AlbumCard, AlbumCardSkeleton } from '../components/AlbumCard';
import { Empty } from '../components/Empty';
import { IconAlert, IconCloudOff, IconDisc, IconList, IconSettings, IconShuffle } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { TrackRow } from '../components/TrackRow';
import { usePaged, useScrollRestore, useSentinel } from '../lib/hooks';
import { useAuth } from '../store/auth';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { toast } from '../store/toast';
import type { DownloadedTrack } from '../lib/db';

type View = 'albums' | 'tracks';

const ALBUM_SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'A → Z' },
  { value: 'artist', label: 'Artiste' },
  { value: 'recent', label: 'Ajouts récents' },
  { value: 'year', label: 'Année' },
];

const TRACK_SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'A → Z' },
  { value: 'artist', label: 'Artiste' },
  { value: 'recent', label: 'Ajouts récents' },
];

/** Regroupe les titres téléchargés par album (mode hors ligne). */
export function groupByAlbum(tracks: DownloadedTrack[]): (Album & { tracks: DownloadedTrack[] })[] {
  const map = new Map<string, Album & { tracks: DownloadedTrack[] }>();
  for (const t of tracks) {
    const key = t.albumId || `single-${t.id}`;
    let a = map.get(key);
    if (!a) {
      a = {
        id: key,
        title: t.album || t.title,
        artist: t.albumArtist || t.artist,
        imageTag: t.imageTag,
        coverId: t.imageId,
        tracks: [],
      };
      map.set(key, a);
    }
    a.tracks.push(t);
  }
  for (const a of map.values()) a.tracks.sort((x, y) => (x.disc ?? 0) - (y.disc ?? 0) || (x.index ?? 0) - (y.index ?? 0));
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

export default function Library() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'tracks' ? 'tracks' : 'albums';
  const [sort, setSort] = useState<SortKey>(() => (sessionStorage.getItem(`sort:${view}`) as SortKey) || 'name');
  const client = useAuth((s) => s.client);
  const session = useAuth((s) => s.session);
  const online = useNetwork((s) => s.online);
  const downloaded = useDownloads((s) => s.downloaded);
  const playQueue = usePlayer((s) => s.playQueue);

  const setView = (v: View) => {
    setParams(v === 'albums' ? {} : { view: v }, { replace: true });
    setSort((sessionStorage.getItem(`sort:${v}`) as SortKey) || 'name');
  };
  const changeSort = (s: SortKey) => {
    sessionStorage.setItem(`sort:${view}`, s);
    setSort(s);
  };

  const albums = usePaged<Album>(online && view === 'albums' ? `albums-${sort}` : null, (start, signal) =>
    client!.getAlbums({ start, sort, signal }),
  );
  const tracks = usePaged<Track>(online && view === 'tracks' ? `tracks-${sort}` : null, (start, signal) =>
    client!.getTracks({ start, sort, signal }),
  );
  const list = view === 'albums' ? albums : tracks;
  const sentinel = useSentinel(list.loadMore, online && !list.done && !list.error, `${view}-${sort}-${list.items.length}`);
  useScrollRestore(`library-${view}-${sort}`, list.items.length > 0);

  // Albums dont au moins un titre est téléchargé (badge)
  const downloadedAlbums = useMemo(() => new Set(Object.values(downloaded).map((t) => t.albumId)), [downloaded]);

  const shuffleAll = async () => {
    try {
      if (!online) {
        const local = Object.values(downloaded);
        if (!local.length) return toast('Aucun titre téléchargé', 'info');
        return playQueue(local, 0, { shuffle: true });
      }
      const random = await client!.getRandomTracks(200);
      if (random.length) playQueue(random, 0, { shuffle: false });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const hour = new Date().getHours();
  const hello = hour < 6 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ minWidth: 0 }}>
          <p className="page-subtitle">
            {hello} {session?.userName} 👋
          </p>
          <h1 className="page-title">Bibliothèque</h1>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <button className="icon-btn" onClick={shuffleAll} aria-label="Lecture aléatoire">
            <IconShuffle />
          </button>
          <Link to="/settings" className="icon-btn" aria-label="Réglages">
            <IconSettings />
          </Link>
        </div>
      </header>

      {!online && (
        <div className="banner">
          <IconCloudOff />
          <span>Vous êtes hors ligne : seuls les titres téléchargés sur cet appareil sont disponibles.</span>
        </div>
      )}

      <Segmented<View>
        label="Affichage"
        value={view}
        onChange={setView}
        options={[
          { value: 'albums', label: 'Albums', icon: <IconDisc /> },
          { value: 'tracks', label: 'Titres', icon: <IconList /> },
        ]}
      />

      {online && (
        <div className="chips" style={{ marginTop: 18 }}>
          {(view === 'albums' ? ALBUM_SORTS : TRACK_SORTS).map((s) => (
            <button key={s.value} className={`chip ${sort === s.value ? 'on' : ''}`} onClick={() => changeSort(s.value)}>
              {s.label}
            </button>
          ))}
          {list.total > 0 && (
            <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5, whiteSpace: 'nowrap', paddingLeft: 4 }}>
              {list.total.toLocaleString('fr-FR')} {view === 'albums' ? 'albums' : 'titres'}
            </span>
          )}
        </div>
      )}

      <div style={{ marginTop: online ? 8 : 24 }}>
        {online ? (
          view === 'albums' ? (
            <div className="album-grid">
              {albums.items.map((a) => (
                <AlbumCard key={a.id} album={a} downloaded={downloadedAlbums.has(a.id)} />
              ))}
              {albums.loading && Array.from({ length: albums.items.length ? 2 : 6 }, (_, i) => <AlbumCardSkeleton key={`sk${i}`} />)}
            </div>
          ) : (
            <div className="track-list">
              {tracks.items.map((t, i) => (
                <TrackRow key={t.id} track={t} showAlbum onPlay={() => playQueue(tracks.items, i)} />
              ))}
              {tracks.loading &&
                Array.from({ length: 6 }, (_, i) => (
                  <div key={`sk${i}`} className="track-row">
                    <div className="skeleton" style={{ width: 50, height: 50, borderRadius: '50%' }} />
                    <div className="info">
                      <div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 8 }} />
                      <div className="skeleton" style={{ height: 10, width: '35%' }} />
                    </div>
                  </div>
                ))}
            </div>
          )
        ) : (
          <OfflineLibrary view={view} />
        )}

        {list.error && (
          <Empty icon={<IconAlert />} title="Impossible de charger la bibliothèque" text={list.error}>
            <button className="btn" onClick={() => list.reload()}>
              Réessayer
            </button>
          </Empty>
        )}
        {online && list.done && !list.items.length && !list.error && (
          <Empty icon={<IconDisc />} title="Bibliothèque vide" text="Aucune musique n'a été trouvée sur le serveur Emby." />
        )}
        <div ref={sentinel} className="sentinel" />
      </div>
    </div>
  );
}

function OfflineLibrary({ view }: { view: View }) {
  const downloaded = useDownloads((s) => s.downloaded);
  const playQueue = usePlayer((s) => s.playQueue);
  const all = useMemo(() => Object.values(downloaded).sort((a, b) => a.title.localeCompare(b.title, 'fr')), [downloaded]);
  const albums = useMemo(() => groupByAlbum(all), [all]);

  if (!all.length) {
    return (
      <Empty
        icon={<IconCloudOff />}
        title="Rien à écouter hors ligne"
        text="Téléchargez des albums ou des titres lorsque vous êtes connecté pour les écouter sans réseau."
      />
    );
  }

  if (view === 'albums') {
    return (
      <div className="album-grid">
        {albums.map((a) => (
          <AlbumCard key={a.id} album={a} downloaded />
        ))}
      </div>
    );
  }
  return (
    <div className="track-list">
      {all.map((t, i) => (
        <TrackRow key={t.id} track={t} showAlbum onPlay={() => playQueue(all, i)} />
      ))}
    </div>
  );
}
