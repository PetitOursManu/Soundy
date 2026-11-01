import { useCallback, useEffect, useMemo, useState } from 'react';
import { MusicRequest, NewRequest, RequestsApi, RequestStatus, RequestType } from '../api/requests';
import { Empty } from '../components/Empty';
import { IconAlert, IconCheck, IconDisc, IconInbox, IconMusic, IconPlus, IconSend, IconServer, IconTrash, IconUser, IconX } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Sheet } from '../components/Sheet';
import { isNative } from '../lib/native';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';

type Tab = 'new' | 'mine' | 'admin';

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'En attente',
  added: 'Ajoutée',
  refused: 'Refusée',
};

const STATUS_FILTER: Record<RequestStatus, string> = {
  pending: 'En attente',
  added: 'Ajoutées',
  refused: 'Refusées',
};

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
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
    { value: 'new' as Tab, label: 'Nouvelle' },
    { value: 'mine' as Tab, label: session.isAdmin ? 'Les miennes' : 'Mes demandes' },
    ...(session.isAdmin ? [{ value: 'admin' as Tab, label: 'Gestion', count: pendingAdmin }] : []),
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Demandes</h1>
          <p className="page-subtitle">Un album ou un titre vous manque ? Demandez-le à l'administrateur.</p>
        </div>
      </header>

      <Segmented<Tab> label="Demandes" value={tab} onChange={setTab} options={tabs} />

      <div style={{ marginTop: 24 }}>
        {!online ? (
          <Empty icon={<IconAlert />} title="Hors ligne" text="Les demandes nécessitent une connexion Internet." />
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
            emptyText="Vous n'avez encore fait aucune demande."
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
    if (!base) return setMsg("Indiquez l'adresse du serveur Soundy.");
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.name !== 'soundy') throw new Error();
      update({ requestsUrl: base });
      toast('Serveur de demandes enregistré ✓', 'success');
      onRetry();
    } catch {
      setMsg(`Aucun serveur Soundy trouvé à « ${base} ».`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <form className="card" onSubmit={save} style={{ padding: 22 }}>
      <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{error ? 'Service de demandes indisponible' : 'Serveur de demandes'}</h3>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
        {error
          ? `${error} Vérifiez l'adresse ci-dessous.`
          : "Indiquez l'adresse de votre serveur Soundy (celle de la version web, ex. https://soundy.mondomaine.fr)."}
      </p>
      <div className="field">
        <label htmlFor="rq-server">Adresse du serveur Soundy</label>
        <div className="input-wrap">
          <IconServer />
          <input
            id="rq-server"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://soundy.mondomaine.fr"
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
          {testing ? <span className="loader" style={{ width: 18, height: 18 }} /> : 'Enregistrer'}
        </button>
        {error && (
          <button className="btn" type="button" onClick={onRetry}>
            Réessayer
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
    if (!artist.trim()) return setErr("Indiquez le nom de l'artiste.");
    if (type === 'album' && !album.trim()) return setErr("Indiquez le nom de l'album.");
    if (type === 'tracks' && !cleanTracks.length) return setErr('Indiquez au moins un titre.');
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
      toast("Demande envoyée à l'administrateur 🎶", 'success');
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
        <span className="field-label">Je souhaite</span>
        <Segmented<RequestType>
          label="Type de demande"
          value={type}
          onChange={setType}
          options={[
            { value: 'album', label: 'Un album', icon: <IconDisc /> },
            { value: 'tracks', label: 'Des titres', icon: <IconMusic /> },
          ]}
        />
      </div>

      <div className="field">
        <label htmlFor="rq-artist">Artiste</label>
        <div className="input-wrap">
          <IconUser />
          <input id="rq-artist" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Ex : Daft Punk" maxLength={120} autoComplete="off" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="rq-album">{type === 'album' ? 'Album' : 'Album (facultatif)'}</label>
        <div className="input-wrap">
          <IconDisc />
          <input id="rq-album" value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Ex : Random Access Memories" maxLength={160} autoComplete="off" />
        </div>
      </div>

      {type === 'tracks' && (
        <div className="field">
          <span className="field-label">Titres</span>
          {tracks.map((t, i) => (
            <div className="input-wrap" key={i}>
              <span style={{ fontSize: 13, fontWeight: 700, width: 18, textAlign: 'center' }}>{i + 1}</span>
              <input
                value={t}
                onChange={(e) => setTrack(i, e.target.value)}
                placeholder="Nom du titre"
                maxLength={160}
                autoComplete="off"
                aria-label={`Titre ${i + 1}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (t.trim() && i === tracks.length - 1) addTrack();
                  }
                }}
                autoFocus={i > 0 && i === tracks.length - 1 && !t}
              />
              {tracks.length > 1 && (
                <button type="button" className="icon-btn sm flat" aria-label="Retirer" onClick={() => setTracks((x) => x.filter((_, j) => j !== i))}>
                  <IconX />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={addTrack} disabled={tracks.length >= 30}>
            <IconPlus /> Ajouter un titre
          </button>
        </div>
      )}

      <div className="field">
        <label htmlFor="rq-comment">Commentaire (facultatif)</label>
        <textarea
          id="rq-comment"
          className="textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Version, édition, lien… tout ce qui peut aider l'administrateur"
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
        Envoyer la demande
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
            {r.type === 'album' ? r.album : `${r.tracks.length} titre${r.tracks.length > 1 ? 's' : ''}`}
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {r.artist}
            {r.type === 'tracks' && r.album ? ` · ${r.album}` : ''}
          </div>
        </div>
        <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
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
          <strong>Réponse de l'admin :</strong> {r.adminNote}
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
  if (!items.length) return <Empty icon={<IconInbox />} title="Aucune demande" text={emptyText} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {items.map((r) => (
        <RequestCard key={r.id} r={r}>
          {r.status === 'pending' && (
            <div style={{ textAlign: 'right', marginTop: 10 }}>
              <button className="btn sm danger" onClick={() => onDelete(r).catch((e) => toast((e as Error).message, 'error'))}>
                <IconTrash /> Annuler la demande
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
      toast(editing.status === 'added' ? 'Demande marquée comme ajoutée' : 'Demande refusée', 'success');
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
            {s === 'all' ? `Toutes (${items.length})` : `${STATUS_FILTER[s]} (${count(s)})`}
          </button>
        ))}
      </div>
      {!shown.length ? (
        <Empty icon={<IconInbox />} title="Rien à traiter" text="Aucune demande dans cette catégorie." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 10 }}>
          {shown.map((r) => (
            <RequestCard key={r.id} r={r} showUser>
              <div className="row" style={{ marginTop: 14, gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="btn sm danger" aria-label="Supprimer" onClick={() => onDelete(r).catch((e) => toast((e as Error).message, 'error'))}>
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
                    <IconX /> Refuser
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
                    <IconCheck /> Ajoutée
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
        title={editing?.status === 'added' ? 'Marquer comme ajoutée' : 'Refuser la demande'}
        description={editing ? `${editing.r.artist}${editing.r.album ? ` — ${editing.r.album}` : ''} · demandé par ${editing.r.userName}` : ''}
      >
        <div className="field">
          <label htmlFor="admin-note">Message pour l'utilisateur (facultatif)</label>
          <textarea
            id="admin-note"
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={editing?.status === 'added' ? 'Ex : Ajouté, bonne écoute !' : 'Ex : Introuvable en bonne qualité'}
          />
        </div>
        <button className={`btn block ${editing?.status === 'added' ? 'accent' : 'danger'}`} onClick={() => void save()}>
          Confirmer
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
