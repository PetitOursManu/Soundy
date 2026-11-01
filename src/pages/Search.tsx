import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Album, Track } from '../api/emby';
import { AlbumCard } from '../components/AlbumCard';
import { Empty } from '../components/Empty';
import { IconAlert, IconSearch, IconX } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { TrackRow } from '../components/TrackRow';
import { mergeAlbums } from '../lib/albums';
import { useDebounced } from '../lib/hooks';
import { useAuth } from '../store/auth';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { groupByAlbum } from './Library';

type Filter = 'all' | 'albums' | 'tracks';

const RECENT_KEY = 'soundy.recentSearches';
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [filter, setFilter] = useState<Filter>((params.get('f') as Filter) || 'all');
  const debounced = useDebounced(query.trim(), 350);
  const client = useAuth((s) => s.client);
  const online = useNetwork((s) => s.online);
  const downloaded = useDownloads((s) => s.downloaded);
  const playQueue = usePlayer((s) => s.playQueue);
  const [results, setResults] = useState<{ albums: Album[]; tracks: Track[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p: Record<string, string> = {};
    if (debounced) p.q = debounced;
    if (filter !== 'all') p.f = filter;
    setParams(p, { replace: true });
  }, [debounced, filter, setParams]);

  // Recherche hors ligne dans les titres téléchargés
  const localResults = useMemo(() => {
    if (online || debounced.length < 1) return null;
    const q = norm(debounced);
    const tracks = Object.values(downloaded).filter((t) => norm(`${t.title} ${t.artist} ${t.album}`).includes(q));
    const albums = groupByAlbum(Object.values(downloaded)).filter((a) => norm(`${a.title} ${a.artist}`).includes(q));
    return { albums, tracks };
  }, [online, debounced, downloaded]);

  useEffect(() => {
    if (!online || !client || debounced.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    client
      .search(debounced, ctrl.signal)
      .then((r) => {
        setResults({ ...r, albums: mergeAlbums(r.albums) });
        setLoading(false);
        // Mémorise la recherche
        setRecent((prev) => {
          const next = [debounced, ...prev.filter((x) => norm(x) !== norm(debounced))].slice(0, 8);
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
          return next;
        });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError((e as Error).message);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced, online, client]);

  const data = online ? results : localResults;
  const showAlbums = filter !== 'tracks' && !!data?.albums.length;
  const showTracks = filter !== 'albums' && !!data?.tracks.length;
  const nothing = data && !showAlbums && !showTracks;

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Recherche</h1>
      </header>

      <div className="input-wrap" style={{ marginBottom: 20 }}>
        <IconSearch />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Album, titre, artiste…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher"
          autoFocus={!query}
        />
        {loading ? (
          <span className="loader" style={{ width: 18, height: 18, borderWidth: 2.5 }} />
        ) : (
          query && (
            <button
              className="icon-btn sm flat"
              aria-label="Effacer"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              <IconX />
            </button>
          )
        )}
      </div>

      <Segmented<Filter>
        label="Filtrer les résultats"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Tout' },
          { value: 'albums', label: 'Albums' },
          { value: 'tracks', label: 'Titres' },
        ]}
      />

      {!debounced && recent.length > 0 && online && (
        <>
          <div className="section-title">
            Recherches récentes
            <button
              className="muted"
              style={{ fontSize: 12, letterSpacing: 0, textTransform: 'none' }}
              onClick={() => {
                setRecent([]);
                localStorage.removeItem(RECENT_KEY);
              }}
            >
              Effacer
            </button>
          </div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {recent.map((r) => (
              <button key={r} className="chip" onClick={() => setQuery(r)}>
                {r}
              </button>
            ))}
          </div>
        </>
      )}

      {!debounced && !recent.length && (
        <Empty icon={<IconSearch />} title="Trouvez votre musique" text="Recherchez un album ou un titre dans toute la bibliothèque Emby." />
      )}

      {error && <Empty icon={<IconAlert />} title="La recherche a échoué" text={error} />}

      {showAlbums && (
        <>
          <div className="section-title">Albums · {data!.albums.length}</div>
          {filter === 'all' ? (
            <div className="h-scroll">
              {data!.albums.map((a) => (
                <AlbumCard key={a.id} album={a} />
              ))}
            </div>
          ) : (
            <div className="album-grid">
              {data!.albums.map((a) => (
                <AlbumCard key={a.id} album={a} />
              ))}
            </div>
          )}
        </>
      )}

      {showTracks && (
        <>
          <div className="section-title" style={filter === 'all' && showAlbums ? { marginTop: 4 } : undefined}>
            Titres · {data!.tracks.length}
          </div>
          <div className="track-list">
            {data!.tracks.map((t, i) => (
              <TrackRow key={t.id} track={t} showAlbum onPlay={() => playQueue(data!.tracks, i, { shuffle: false })} />
            ))}
          </div>
        </>
      )}

      {nothing && !loading && (
        <Empty
          icon={<IconSearch />}
          title="Aucun résultat"
          text={`Rien ne correspond à « ${debounced} »${online ? '. Vous pouvez demander son ajout dans l’onglet Demandes.' : ' parmi vos titres téléchargés.'}`}
        />
      )}
    </div>
  );
}
