import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Album, SortKey, Track } from '../api/emby';
import { AlbumCard, AlbumCardSkeleton } from '../components/AlbumCard';
import { Brand } from '../components/Brand';
import { Empty } from '../components/Empty';
import { IconAlert, IconCheck, IconCloudOff, IconDisc, IconDownload, IconList, IconSettings, IconShuffle, IconX } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { TrackWheel } from '../components/TrackWheel';
import { Key, useT } from '../i18n';
import { artistTokens, mergeAlbums, normName } from '../lib/albums';
import { usePaged, useScrollRestore, useSentinel } from '../lib/hooks';
import { useAuth } from '../store/auth';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { toast } from '../store/toast';
import type { DownloadedTrack } from '../lib/db';

type View = 'albums' | 'tracks';

const ALBUM_SORTS: { value: SortKey; label: Key }[] = [
  { value: 'artist', label: 'library.sort.artist' },
  { value: 'name', label: 'library.sort.name' },
  { value: 'recent', label: 'library.sort.recent' },
  { value: 'year', label: 'library.sort.year' },
];

const TRACK_SORTS: { value: SortKey; label: Key }[] = [
  { value: 'name', label: 'library.sort.name' },
  { value: 'artist', label: 'library.sort.artist' },
  { value: 'recent', label: 'library.sort.recent' },
];

/** Regroupe les titres téléchargés par album (mode hors ligne). */
export function groupByAlbum(tracks: DownloadedTrack[]): (Album & { tracks: DownloadedTrack[] })[] {
  const map = new Map<string, Album & { tracks: DownloadedTrack[] }>();
  for (const t of tracks) {
    const key = t.album ? `${normName(t.album)}|${artistTokens(t.albumArtist || t.artist)[0] ?? ''}` : `single-${t.id}`;
    let a = map.get(key);
    if (!a) {
      a = {
        id: t.albumId || `single-${t.id}`,
        ids: [],
        title: t.album || t.title,
        artist: t.albumArtist || t.artist,
        imageTag: t.imageTag,
        coverId: t.imageId,
        tracks: [],
      };
      map.set(key, a);
    }
    a.tracks.push(t);
    if (t.albumId && !a.ids!.includes(t.albumId)) a.ids!.push(t.albumId);
  }
  for (const a of map.values()) if (!a.ids!.length) a.ids = [a.id];
  for (const a of map.values()) a.tracks.sort((x, y) => (x.disc ?? 0) - (y.disc ?? 0) || (x.index ?? 0) - (y.index ?? 0));
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

export default function Library() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'tracks' ? 'tracks' : 'albums';
  // Par défaut : albums rangés par artiste puis par ordre alphabétique ; titres de A à Z
  const defaultSort = (v: View): SortKey => (v === 'albums' ? 'artist' : 'name');
  const [sort, setSort] = useState<SortKey>(() => (sessionStorage.getItem(`sort2:${view}`) as SortKey) || defaultSort(view));
  const client = useAuth((s) => s.client);
  const { t, tn, locale } = useT();
  const online = useNetwork((s) => s.online);
  const downloaded = useDownloads((s) => s.downloaded);
  const playQueue = usePlayer((s) => s.playQueue);

  const setView = (v: View) => {
    setParams(v === 'albums' ? {} : { view: v }, { replace: true });
    setSort((sessionStorage.getItem(`sort2:${v}`) as SortKey) || defaultSort(v));
  };
  const changeSort = (s: SortKey) => {
    sessionStorage.setItem(`sort2:${view}`, s);
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

  // Albums éclatés par Emby réunis (voir lib/albums.ts)
  const mergedAlbums = useMemo(() => mergeAlbums(albums.items), [albums.items]);

  // --- Sélection multiple (téléchargement de plusieurs albums) ---------------
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<string, Album>>(new Map());
  const [busy, setBusy] = useState(false);
  const keyOf = (a: Album) => (a.ids ?? [a.id]).join(',');
  const toggleAlbum = useCallback((a: Album) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const k = (a.ids ?? [a.id]).join(',');
      if (next.has(k)) next.delete(k);
      else next.set(k, a);
      return next;
    });
  }, []);
  const startSelect = useCallback(
    (a?: Album) => {
      setSelecting(true);
      setSelected(a ? new Map([[(a.ids ?? [a.id]).join(','), a]]) : new Map());
    },
    [],
  );
  const stopSelect = () => {
    setSelecting(false);
    setSelected(new Map());
  };
  useEffect(() => {
    if (view !== 'albums' || !online) stopSelect();
  }, [view, online]);
  // Échap (ou bouton retour d'Android) quitte la sélection
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stopSelect();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  const downloadSelected = async () => {
    const list = [...selected.values()];
    if (!list.length || !client) return;
    setBusy(true);
    try {
      const all: Track[] = [];
      for (const a of list) all.push(...(await client.getTracksOfAlbums(a.ids ?? [a.id])));
      useDownloads.getState().download(all);
      toast(t('library.selectionQueued', { albums: tn('common.albums', list.length), tracks: tn('common.tracks', all.length) }), 'success');
      stopSelect();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Albums dont au moins un titre est téléchargé (badge)
  const downloadedAlbums = useMemo(() => new Set(Object.values(downloaded).map((t) => t.albumId)), [downloaded]);

  const shuffleAll = async () => {
    try {
      if (!online) {
        const local = Object.values(downloaded);
        if (!local.length) return toast(t('library.noDownloads'), 'info');
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
          <span className="sr-only">{t('library.title')}</span>
        </h1>
        <div className="row" style={{ gap: 14 }}>
          <button className="icon-btn" onClick={shuffleAll} aria-label={t('library.shuffle')}>
            <IconShuffle />
          </button>
          <Link to="/settings" className="icon-btn" aria-label={t('library.settings')}>
            <IconSettings />
          </Link>
        </div>
      </header>

      {!online && (
        <div className="banner">
          <IconCloudOff />
          <span>{t('library.offlineBanner')}</span>
        </div>
      )}

      <Segmented<View>
        label={t('library.view')}
        value={view}
        onChange={setView}
        options={[
          { value: 'albums', label: t('library.albums'), icon: <IconDisc /> },
          { value: 'tracks', label: t('library.tracks'), icon: <IconList /> },
        ]}
      />

      {online && (
        <div className="chips" style={{ marginTop: 18 }}>
          {(view === 'albums' ? ALBUM_SORTS : TRACK_SORTS).map((s) => (
            <button key={s.value} className={`chip ${sort === s.value ? 'on' : ''}`} onClick={() => changeSort(s.value)}>
              {t(s.label)}
            </button>
          ))}
          {list.total > 0 && (
            <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5, whiteSpace: 'nowrap', paddingLeft: 4 }}>
              {(view === 'albums' ? Math.max(mergedAlbums.length, list.total - (albums.items.length - mergedAlbums.length)) : list.total).toLocaleString(locale)}{' '}
              {view === 'albums' ? t('library.albums').toLowerCase() : t('library.tracks').toLowerCase()}
            </span>
          )}
          {view === 'albums' && (
            <button className={`chip ${selecting ? 'on' : ''}`} onClick={() => (selecting ? stopSelect() : startSelect())} style={{ marginLeft: 'auto' }}>
              {selecting ? t('common.cancel') : t('library.select')}
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: online ? 8 : 24, ...(view === 'tracks' ? { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } : {}) }}>
        {online ? (
          view === 'albums' ? (
            <div className="album-grid">
              {mergedAlbums.map((a) => (
                <AlbumCard
                  key={a.id}
                  album={a}
                  downloaded={(a.ids ?? [a.id]).some((id) => downloadedAlbums.has(id))}
                  selecting={selecting}
                  selected={selected.has(keyOf(a))}
                  onToggle={toggleAlbum}
                  onLongPress={startSelect}
                />
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
          <Empty icon={<IconAlert />} title={t('library.loadError')} text={list.error}>
            <button className="btn" onClick={() => list.reload()}>
              {t('common.retry')}
            </button>
          </Empty>
        )}
        {online && list.done && !list.items.length && !list.error && (
          <Empty icon={<IconDisc />} title={t('library.empty')} text={t('library.emptyText')} />
        )}
        {view === 'albums' && <div ref={sentinel} className="sentinel" />}
      </div>

      {selecting && (
        <div className="select-bar" role="toolbar" aria-label={t('library.selection')}>
          <button className="icon-btn flat" onClick={stopSelect} aria-label={t('library.quitSelection')}>
            <IconX />
          </button>
          <div className="meta">
            <strong>
              {tn('common.albums', selected.size)}
            </strong>
            <button
              className="link"
              onClick={() =>
                setSelected(selected.size === mergedAlbums.length ? new Map() : new Map(mergedAlbums.map((a) => [keyOf(a), a])))
              }
            >
              <IconCheck /> {selected.size === mergedAlbums.length ? t('library.unselectAll') : t('library.selectAll')}
            </button>
          </div>
          <button className="btn accent sm" disabled={!selected.size || busy} onClick={() => void downloadSelected()}>
            {busy ? <span className="loader" style={{ width: 16, height: 16 }} /> : <IconDownload />}
            {t('library.download')}
          </button>
        </div>
      )}
    </div>
  );
}

function OfflineLibrary({ view }: { view: View }) {
  const { t } = useT();
  const downloaded = useDownloads((s) => s.downloaded);
  const playQueue = usePlayer((s) => s.playQueue);
  const all = useMemo(() => Object.values(downloaded).sort((a, b) => a.title.localeCompare(b.title, 'fr')), [downloaded]);
  const albums = useMemo(() => groupByAlbum(all), [all]);

  if (!all.length) {
    return (
      <Empty
        icon={<IconCloudOff />}
        title={t('library.offlineEmpty')}
        text={t('library.offlineEmptyText')}
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
