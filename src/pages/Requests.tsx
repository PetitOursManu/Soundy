import { useCallback, useEffect, useMemo, useState } from 'react';
import { MusicRequest, NewRequest, RequestsApi, RequestStatus, RequestType } from '../api/requests';
import { Empty } from '../components/Empty';
import { IconAlert, IconCheck, IconDisc, IconInbox, IconMusic, IconPlus, IconSend, IconServer, IconTrash, IconUser, IconX } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Sheet } from '../components/Sheet';
import { currentLocale, Key, t, tn } from '../i18n';
import { isNative } from '../lib/native';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';

type Tab = 'new' | 'mine' | 'admin';

const STATUS_LABEL: Record<RequestStatus, Key> = {
  pending: 'requests.status.pending',
  added: 'requests.status.added',
  refused: 'requests.status.refused',
};

const STATUS_FILTER: Record<RequestStatus, Key> = {
  pending: 'requests.filter.pending',
  added: 'requests.filter.added',
  refused: 'requests.filter.refused',
};

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' });
  if (diff < 60) return t('requests.justNow');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Requests() {
  const session = useAuth((s) => s.session)!;
  const requestsUrl = useSettings((s) => s.requestsUrl);
  const online = useNetwork((s) => s.online);
  const api = useMemo(() => new RequestsApi(requestsUrl, session), [requestsUrl, session]);
  const [tab, setTab] = useState<Tab>('new');
  const [mine, setMine] = useState<MusicRequest[] | null>(null);
  const [all, setAll] = useState<MusicRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Appli Android : l'adresse du serveur Soundy doit être renseignée (pas de « même origine »)
  const needsSetup = isNative() && !requestsUrl;

  const refresh = useCallback(async () => {
    if (!online || needsSetup) return;
    setError(null);
    try {
      const [m, a] = await Promise.all([api.list('mine'), session.isAdmin ? api.list('all') : Promise.resolve(null)]);
      setMine(m);
      setAll(a);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, online, session.isAdmin, needsSetup]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingAdmin = all?.filter((r) => r.status === 'pending').length ?? 0;
  const tabs = [
    { value: 'new' as Tab, label: t('requests.tabNew') },
    { value: 'mine' as Tab, label: session.isAdmin ? t('requests.tabMineAdmin') : t('requests.tabMine') },
    ...(session.isAdmin ? [{ value: 'admin' as Tab, label: t('requests.tabAdmin'), count: pendingAdmin }] : []),
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">{t('requests.title')}</h1>
          <p className="page-subtitle">{t('requests.subtitle')}</p>
        </div>
      </header>

      <Segmented<Tab> label={t('requests.title')} value={tab} onChange={setTab} options={tabs} />

      <div style={{ marginTop: 24 }}>
        {!online ? (
          <Empty icon={<IconAlert />} title={t('common.offline')} text={t('requests.offlineText')} />
        ) : needsSetup || error ? (
          <ServerSetup error={needsSetup ? null : error} onRetry={() => void refresh()} />
        ) : tab === 'new' ? (
          <RequestForm
            api={api}
            onCreated={(r) => {
              setMine((m) => [r, ...(m ?? [])]);
              if (session.isAdmin) setAll((a) => [r, ...(a ?? [])]);
              setTab('mine');
            }}
          />
        ) : tab === 'mine' ? (
          <RequestList
            items={mine}
            emptyText={t('requests.noneText')}
            onDelete={async (r) => {
              await api.remove(r.id);
              setMine((m) => m?.filter((x) => x.id !== r.id) ?? null);
              setAll((a) => a?.filter((x) => x.id !== r.id) ?? null);
            }}
          />
        ) : (
          <AdminList
            items={all}
            onUpdate={async (r, status, adminNote) => {
              const updated = await api.update(r.id, { status, adminNote });
              const swap = (l: MusicRequest[] | null) => l?.map((x) => (x.id === updated.id ? updated : x)) ?? null;
              setAll(swap);
              setMine(swap);
            }}
            onDelete={async (r) => {
              await api.remove(r.id);
              setAll((a) => a?.filter((x) => x.id !== r.id) ?? null);
              setMine((m) => m?.filter((x) => x.id !== r.id) ?? null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adresse du serveur de demandes (appli Android / serveur injoignable)
// ---------------------------------------------------------------------------
function ServerSetup({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const current = useSettings((s) => s.requestsUrl);
  const update = useSettings((s) => s.update);
  const [url, setUrl] = useState(current);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    let base = url.trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = `https://${base}`;
    if (!base) return setMsg(t('requests.serverMissing'));
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.name !== 'soundy') throw new Error();
      update({ requestsUrl: base });
      toast(t('requests.serverSaved'), 'success');
      onRetry();
    } catch {
      setMsg(t('requests.serverNotFound', { url: base }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <form className="card" onSubmit={save} style={{ padding: 22 }}>
      <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{error ? t('requests.serverUnavailable') : t('requests.serverTitle')}</h3>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
        {error
          ? t('requests.serverCheck', { error })
          : t('requests.serverHelp')}
      </p>
      <div className="field">
        <label htmlFor="rq-server">{t('requests.serverAddress')}</label>
        <div className="input-wrap">
          <IconServer />
          <input
            id="rq-server"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://soundy.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      </div>
      {msg && (
        <p className="error-text" style={{ marginBottom: 14 }}>
          {msg}
        </p>
      )}
      <div className="row" style={{ gap: 12 }}>
        <button className="btn accent" type="submit" disabled={testing} style={{ flex: 1 }}>
          {testing ? <span className="loader" style={{ width: 18, height: 18 }} /> : t('common.save')}
        </button>
        {error && (
          <button className="btn" type="button" onClick={onRetry}>
            {t('common.retry')}
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Formulaire
// ---------------------------------------------------------------------------
function RequestForm({ api, onCreated }: { api: RequestsApi; onCreated: (r: MusicRequest) => void }) {
  const [type, setType] = useState<RequestType>('album');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [tracks, setTracks] = useState<string[]>(['']);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cleanTracks = tracks.map((t) => t.trim()).filter(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!artist.trim()) return setErr(t('requests.needArtist'));
    if (type === 'album' && !album.trim()) return setErr(t('requests.needAlbum'));
    if (type === 'tracks' && !cleanTracks.length) return setErr(t('requests.needTrack'));
    const req: NewRequest = {
      type,
      artist: artist.trim(),
      album: album.trim() || undefined,
      tracks: type === 'tracks' ? cleanTracks : [],
      comment: comment.trim() || undefined,
    };
    setSending(true);
    try {
      const created = await api.create(req);
      toast(t('requests.sent'), 'success');
      setArtist('');
      setAlbum('');
      setTracks(['']);
      setComment('');
      onCreated(created);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSending(false);
    }
  };

  const setTrack = (i: number, v: string) => setTracks((t) => t.map((x, j) => (j === i ? v : x)));
  const addTrack = () => setTracks((t) => (t.length < 30 ? [...t, ''] : t));

  return (
    <form className="card" onSubmit={submit} style={{ padding: 22 }}>
      <div className="field">
        <span className="field-label">{t('requests.iWant')}</span>
        <Segmented<RequestType>
          label={t('requests.type')}
          value={type}
          onChange={setType}
          options={[
            { value: 'album', label: t('requests.typeAlbum'), icon: <IconDisc /> },
            { value: 'tracks', label: t('requests.typeTracks'), icon: <IconMusic /> },
          ]}
        />
      </div>

      <div className="field">
        <label htmlFor="rq-artist">{t('requests.artist')}</label>
        <div className="input-wrap">
          <IconUser />
          <input id="rq-artist" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Daft Punk" maxLength={120} autoComplete="off" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="rq-album">{type === 'album' ? t('requests.album') : t('requests.albumOptional')}</label>
        <div className="input-wrap">
          <IconDisc />
          <input id="rq-album" value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Random Access Memories" maxLength={160} autoComplete="off" />
        </div>
      </div>

      {type === 'tracks' && (
        <div className="field">
          <span className="field-label">{t('requests.tracks')}</span>
          {tracks.map((name, i) => (
            <div className="input-wrap" key={i}>
              <span style={{ fontSize: 13, fontWeight: 700, width: 18, textAlign: 'center' }}>{i + 1}</span>
              <input
                value={name}
                onChange={(e) => setTrack(i, e.target.value)}
                placeholder={t('requests.trackName')}
                maxLength={160}
                autoComplete="off"
                aria-label={t('requests.trackN', { n: i + 1 })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (name.trim() && i === tracks.length - 1) addTrack();
                  }
                }}
                autoFocus={i > 0 && i === tracks.length - 1 && !name}
              />
              {tracks.length > 1 && (
                <button type="button" className="icon-btn sm flat" aria-label={t('requests.removeTrack')} onClick={() => setTracks((x) => x.filter((_, j) => j !== i))}>
                  <IconX />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={addTrack} disabled={tracks.length >= 30}>
            <IconPlus /> {t('requests.addTrack')}
          </button>
        </div>
      )}

      <div className="field">
        <label htmlFor="rq-comment">{t('requests.comment')}</label>
        <textarea
          id="rq-comment"
          className="textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('requests.commentPlaceholder')}
          maxLength={500}
        />
      </div>

      {err && (
        <p className="error-text" style={{ marginBottom: 14 }}>
          {err}
        </p>
      )}

      <button className="btn accent block" type="submit" disabled={sending}>
        {sending ? <span className="loader" style={{ width: 18, height: 18 }} /> : <IconSend />}
        {t('requests.send')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Listes
// ---------------------------------------------------------------------------
function RequestCard({ r, showUser, children }: { r: MusicRequest; showUser?: boolean; children?: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="icon-btn sm" style={{ color: 'var(--accent)', pointerEvents: 'none' }}>
          {r.type === 'album' ? <IconDisc /> : <IconMusic />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {r.type === 'album' ? r.album : tn('common.tracks', r.tracks.length)}
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {r.artist}
            {r.type === 'tracks' && r.album ? ` · ${r.album}` : ''}
          </div>
        </div>
        <span className={`badge ${r.status}`}>{t(STATUS_LABEL[r.status])}</span>
      </div>

      {r.type === 'tracks' && (
        <ol style={{ margin: '12px 0 0', paddingLeft: 58, fontSize: 13.5, lineHeight: 1.7, color: 'var(--text)' }}>
          {r.tracks.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
      {r.comment && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10, paddingLeft: 52, fontStyle: 'italic', lineHeight: 1.5 }}>
          « {r.comment} »
        </p>
      )}
      {r.adminNote && (
        <div className="neu-inset" style={{ marginTop: 12, padding: '10px 14px', borderRadius: 14, fontSize: 13, lineHeight: 1.5 }}>
          <strong>{t('requests.adminReply')}</strong> {r.adminNote}
        </div>
      )}
      <div className="row" style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)', fontWeight: 600, paddingLeft: 52, gap: 6 }}>
        {showUser && (
          <>
            <IconUser style={{ width: 13, height: 13 }} /> {r.userName} ·
          </>
        )}
        {timeAgo(r.createdAt)}
      </div>
      {children}
    </div>
  );
}

function RequestList({ items, emptyText, onDelete }: { items: MusicRequest[] | null; emptyText: string; onDelete: (r: MusicRequest) => Promise<void> }) {
  if (!items) return <ListSkeleton />;
  if (!items.length) return <Empty icon={<IconInbox />} title={t('requests.none')} text={emptyText} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {items.map((r) => (
        <RequestCard key={r.id} r={r}>
          {r.status === 'pending' && (
            <div style={{ textAlign: 'right', marginTop: 10 }}>
              <button className="btn sm danger" onClick={() => onDelete(r).catch((e) => toast((e as Error).message, 'error'))}>
                <IconTrash /> {t('requests.cancelRequest')}
              </button>
            </div>
          )}
        </RequestCard>
      ))}
    </div>
  );
}

function AdminList({
  items,
  onUpdate,
  onDelete,
}: {
  items: MusicRequest[] | null;
  onUpdate: (r: MusicRequest, s: RequestStatus, note?: string) => Promise<void>;
  onDelete: (r: MusicRequest) => Promise<void>;
}) {
  const [filter, setFilter] = useState<RequestStatus | 'all'>('pending');
  const [editing, setEditing] = useState<{ r: MusicRequest; status: RequestStatus } | null>(null);
  const [note, setNote] = useState('');

  if (!items) return <ListSkeleton />;
  const shown = filter === 'all' ? items : items.filter((r) => r.status === filter);
  const count = (s: RequestStatus) => items.filter((r) => r.status === s).length;

  const save = async () => {
    if (!editing) return;
    try {
      await onUpdate(editing.r, editing.status, note.trim() || undefined);
      toast(editing.status === 'added' ? t('requests.markedAdded') : t('requests.markedRefused'), 'success');
      setEditing(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <div className="chips">
        {(['pending', 'added', 'refused', 'all'] as const).map((s) => (
          <button key={s} className={`chip ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>
            {s === 'all' ? t('requests.filter.all', { n: items.length }) : `${t(STATUS_FILTER[s])} (${count(s)})`}
          </button>
        ))}
      </div>
      {!shown.length ? (
        <Empty icon={<IconInbox />} title={t('requests.nothing')} text={t('requests.nothingText')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 10 }}>
          {shown.map((r) => (
            <RequestCard key={r.id} r={r} showUser>
              <div className="row" style={{ marginTop: 14, gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="btn sm danger" aria-label={t('common.delete')} onClick={() => onDelete(r).catch((e) => toast((e as Error).message, 'error'))}>
                  <IconTrash />
                </button>
                {r.status !== 'refused' && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      setNote(r.adminNote ?? '');
                      setEditing({ r, status: 'refused' });
                    }}
                  >
                    <IconX /> {t('requests.refuse')}
                  </button>
                )}
                {r.status !== 'added' && (
                  <button
                    className="btn sm success"
                    onClick={() => {
                      setNote(r.adminNote ?? '');
                      setEditing({ r, status: 'added' });
                    }}
                  >
                    <IconCheck /> {t('requests.markAdded')}
                  </button>
                )}
              </div>
            </RequestCard>
          ))}
        </div>
      )}

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.status === 'added' ? t('requests.markAddedTitle') : t('requests.refuseTitle')}
        description={editing ? `${editing.r.artist}${editing.r.album ? ` — ${editing.r.album}` : ''} · ${t('requests.requestedBy', { user: editing.r.userName })}` : ''}
      >
        <div className="field">
          <label htmlFor="admin-note">{t('requests.noteLabel')}</label>
          <textarea
            id="admin-note"
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={editing?.status === 'added' ? t('requests.notePlaceholderAdded') : t('requests.notePlaceholderRefused')}
          />
        </div>
        <button className={`btn block ${editing?.status === 'added' ? 'accent' : 'danger'}`} onClick={() => void save()}>
          {t('common.confirm')}
        </button>
      </Sheet>
    </>
  );
}

function ListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card" style={{ padding: 18 }}>
          <div className="skeleton" style={{ height: 14, width: '50%', marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 11, width: '30%' }} />
        </div>
      ))}
    </div>
  );
}
