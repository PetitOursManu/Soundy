import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Album, SortKey, Track } from '../api/emby';
import { AlbumCard, AlbumCardSkeleton } from '../components/AlbumCard';
import { Brand } from '../components/Brand';
import { Empty } from '../components/Empty';
import { IconAlert, IconCloudOff, IconDisc, IconList, IconSettings, IconShuffle } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { TrackWheel } from '../components/TrackWheel';
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
  const sentinel = useSentinel(albums.loadMore, online && view === 'albums' && !albums.done && !albums.error, `${sort}-${albums.items.length}`);
  useScrollRestore(`library-albums-${sort}`, view === 'albums' && albums.items.length > 0);

  // Vue Titres : premier chargement (la suite est chargée par la roue)
  useEffect(() => {
    if (online && view === 'tracks' && !tracks.items.length && !tracks.done && !tracks.loading && !tracks.error) void tracks.loadMore();
  }, [online, view, tracks]);

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


  return (
    <div className={`page ${view === 'tracks' ? 'page-fill' : ''}`}>
      <header className="page-header">
        <h1 style={{ margin: 0 }}>
          <Brand size={46} />
          <span className="sr-only">Bibliothèque</span>
        </h1>
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

      <div style={{ marginTop: online ? 8 : 24, ...(view === 'tracks' ? { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } : {}) }}>
        {online ? (
          view === 'albums' ? (
            <div className="album-grid">
              {albums.items.map((a) => (
                <AlbumCard key={a.id} album={a} downloaded={downloadedAlbums.has(a.id)} />
              ))}
              {albums.loading && Array.from({ length: albums.items.length ? 2 : 6 }, (_, i) => <AlbumCardSkeleton key={`sk${i}`} />)}
            </div>
          ) : (
            tracks.items.length > 0 ? (
              <div className="wheel-area">
                <TrackWheel
                  key={sort}
                  tracks={tracks.items}
                  total={tracks.total}
                  mode="tracks"
                  storageKey={`tracks-${sort}`}
                  onPlay={(i) => playQueue(tracks.items, i, { shuffle: false })}
                  onNearEnd={tracks.loadMore}
                />
              </div>
            ) : (
              tracks.loading && <WheelSkeleton />
            )
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
        {view === 'albums' && <div ref={sentinel} className="sentinel" />}
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
    <div className="wheel-area">
      <TrackWheel tracks={all} mode="tracks" storageKey="tracks-offline" onPlay={(i) => playQueue(all, i, { shuffle: false })} />
    </div>
  );
}

function WheelSkeleton() {
  return (
    <div className="wheel-area" aria-hidden>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 26, padding: '0 34px' }}>
        {[0.45, 1, 0.45].map((o, i) => (
          <div key={i} className="row" style={{ opacity: o, gap: 16 }}>
            <div className="skeleton" style={{ width: 64, height: 64, borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ height: 14, width: '55%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 10, width: '30%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
