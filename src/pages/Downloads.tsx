import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Empty } from '../components/Empty';
import { IconDisc, IconDownload, IconList, IconPlay, IconShuffle, IconTrash, IconX } from '../components/Icons';
import { ProgressRing } from '../components/ProgressRing';
import { Segmented } from '../components/Segmented';
import { Sheet } from '../components/Sheet';
import { TrackRow } from '../components/TrackRow';
import { formatBytes, plural } from '../lib/format';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { groupByAlbum } from './Library';

type View = 'albums' | 'tracks';

export default function Downloads() {
  const downloaded = useDownloads((s) => s.downloaded);
  const tasks = useDownloads((s) => s.tasks);
  const { cancel, retry, remove, clear } = useDownloads.getState();
  const playQueue = usePlayer((s) => s.playQueue);
  const [view, setView] = useState<View>('albums');
  const [confirm, setConfirm] = useState(false);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);

  const all = useMemo(() => Object.values(downloaded).sort((a, b) => a.title.localeCompare(b.title, 'fr')), [downloaded]);
  const albums = useMemo(() => groupByAlbum(all), [all]);
  const used = all.reduce((s, t) => s + t.size, 0);

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setQuota({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => {});
  }, [used]);

  const pct = quota?.quota ? Math.min(100, (used / quota.quota) * 100) : 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Hors ligne</h1>
          <p className="page-subtitle">
            {plural(all.length, 'titre')} · {formatBytes(used)}
          </p>
        </div>
        {all.length > 0 && (
          <div className="row" style={{ gap: 14 }}>
            <button className="icon-btn" aria-label="Lecture aléatoire" onClick={() => playQueue(all, 0, { shuffle: true })}>
              <IconShuffle />
            </button>
            <button className="icon-btn accent" aria-label="Tout lire" onClick={() => playQueue(all, 0, { shuffle: false })}>
              <IconPlay style={{ marginLeft: 2 }} />
            </button>
          </div>
        )}
      </header>

      {/* Stockage */}
      <div className="card" style={{ marginBottom: 26 }}>
        <div style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>Stockage de l'appareil</strong>
          <p className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            {formatBytes(used)} utilisés par Soundy
            {quota?.quota ? ` · ${formatBytes(Math.max(0, quota.quota - quota.usage))} libres` : ''}
          </p>
        </div>
        <div className="neu-inset" style={{ height: 12, borderRadius: 12, padding: 2 }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(pct, used ? 2 : 0)}%`,
              borderRadius: 10,
              background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
              transition: 'width .4s',
            }}
          />
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12, lineHeight: 1.5 }}>
          Les titres téléchargés sont lus en priorité depuis l'appareil, même si vous êtes connecté.
        </p>
      </div>

      {/* Téléchargements en cours */}
      {tasks.length > 0 && (
        <>
          <div className="section-title">En cours · {tasks.length}</div>
          <div className="track-list" style={{ marginBottom: 10 }}>
            {tasks.map((t) => (
              <div key={t.track.id} className="track-row">
                <Cover imageId={t.track.imageId} tag={t.track.imageTag} size={100} style={{ width: 46, height: 46 }} />
                <div className="info">
                  <div className="t ellipsis">{t.track.title}</div>
                  <div className="s ellipsis" style={t.status === 'error' ? { color: 'var(--danger)' } : undefined}>
                    {t.status === 'error' ? t.error : t.status === 'queued' ? 'En attente…' : `${Math.round(t.progress * 100)} %`}
                  </div>
                </div>
                {t.status === 'error' ? (
                  <button className="btn sm" onClick={() => retry(t.track.id)}>
                    Réessayer
                  </button>
                ) : (
                  <ProgressRing value={t.progress} size={26} />
                )}
                <button className="icon-btn sm flat" aria-label="Annuler" onClick={() => cancel(t.track.id)}>
                  <IconX />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {all.length === 0 && tasks.length === 0 ? (
        <Empty
          icon={<IconDownload />}
          title="Aucun titre téléchargé"
          text="Depuis un album ou un titre, touchez l'icône de téléchargement pour l'écouter sans connexion."
        >
          <Link to="/" className="btn">
            Parcourir la bibliothèque
          </Link>
        </Empty>
      ) : (
        all.length > 0 && (
          <>
            <Segmented<View>
              label="Affichage"
              value={view}
              onChange={setView}
              options={[
                { value: 'albums', label: 'Albums', icon: <IconDisc /> },
                { value: 'tracks', label: 'Titres', icon: <IconList /> },
              ]}
            />
            <div style={{ marginTop: 20 }}>
              {view === 'albums' ? (
                <div className="track-list">
                  {albums.map((a) => {
                    const size = a.tracks.reduce((s, t) => s + t.size, 0);
                    return (
                      <div key={a.id} className="track-row">
                        <Link to={`/album/${a.id}`} className="row" style={{ flex: 1, minWidth: 0, gap: 14 }}>
                          <Cover imageId={a.coverId} tag={a.imageTag} size={120} style={{ width: 54, height: 54 }} />
                          <div className="info">
                            <div className="t ellipsis">{a.title}</div>
                            <div className="s ellipsis">
                              {a.artist} · {plural(a.tracks.length, 'titre')} · {formatBytes(size)}
                            </div>
                          </div>
                        </Link>
                        <button
                          className="icon-btn sm flat"
                          aria-label="Supprimer de l'appareil"
                          onClick={() => void remove(a.tracks.map((t) => t.id))}
                        >
                          <IconTrash />
                        </button>
                        <button className="play" aria-label="Lire l'album" onClick={() => playQueue(a.tracks, 0, { shuffle: false })}>
                          <IconPlay style={{ marginLeft: 2 }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="track-list">
                  {all.map((t, i) => (
                    <TrackRow key={t.id} track={t} showAlbum onPlay={() => playQueue(all, i, { shuffle: false })} />
                  ))}
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', marginTop: 34 }}>
              <button className="btn danger" onClick={() => setConfirm(true)}>
                <IconTrash /> Tout supprimer
              </button>
            </div>
          </>
        )
      )}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Tout supprimer ?"
        description={`${plural(all.length, 'titre')} (${formatBytes(used)}) seront retirés de cet appareil. Ils resteront disponibles en streaming.`}
      >
        <div className="row" style={{ gap: 14 }}>
          <button className="btn block" onClick={() => setConfirm(false)}>
            Annuler
          </button>
          <button
            className="btn block danger"
            onClick={() => {
              void clear();
              setConfirm(false);
            }}
          >
            Supprimer
          </button>
        </div>
      </Sheet>
    </div>
  );
}
