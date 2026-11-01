import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../api/emby';
import { IconBack, IconLogout, IconServer } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Sheet } from '../components/Sheet';
import { formatBytes, plural } from '../lib/format';
import { clearPagedCache } from '../lib/hooks';
import { isNative } from '../lib/native';
import { useAuth } from '../store/auth';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { BITRATES, DownloadQuality, Theme, useSettings } from '../store/settings';
import { toast } from '../store/toast';

export default function Settings() {
  const navigate = useNavigate();
  const session = useAuth((s) => s.session)!;
  const logout = useAuth((s) => s.logout);
  const settings = useSettings();
  const [requestsUrl, setRequestsUrl] = useState(settings.requestsUrl);
  const [testing, setTesting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const downloaded = useDownloads((s) => s.downloaded);
  const pending = useDownloads((s) => s.tasks.length);
  const dlCount = Object.keys(downloaded).length;
  const dlSize = Object.values(downloaded).reduce((n, t) => n + t.size, 0);
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => e.quota && setFree(Math.max(0, e.quota - (e.usage ?? 0))))
      .catch(() => {});
  }, [dlSize]);

  const testRequests = async () => {
    const base = requestsUrl.trim().replace(/\/+$/, '');
    setTesting(true);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error();
      settings.update({ requestsUrl: base });
      toast('Serveur de demandes joignable ✓', 'success');
    } catch {
      toast('Serveur de demandes injoignable', 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Retour">
          <IconBack />
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>Réglages</h1>
        <span style={{ width: 46 }} />
      </header>

      <div className="card row" style={{ gap: 16 }}>
        <div
          className="neu-inset"
          style={{ width: 60, height: 60, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 800, color: 'var(--accent)', flex: 'none' }}
        >
          {session.userName.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 17 }} className="ellipsis">
            {session.userName}
          </div>
          <div className="muted ellipsis" style={{ fontSize: 13, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconServer style={{ width: 14, height: 14, flex: 'none' }} /> {session.server.replace(/^https?:\/\//, '')}
          </div>
        </div>
        {session.isAdmin && <span className="badge added">Admin</span>}
      </div>

      <div className="section-title">Apparence</div>
      <Segmented<Theme>
        label="Thème"
        value={settings.theme}
        onChange={(theme) => settings.update({ theme })}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'light', label: 'Clair' },
          { value: 'dark', label: 'Sombre' },
        ]}
      />

      <div className="section-title">Lecture</div>
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bitrate">Qualité du streaming</label>
          <select
            id="bitrate"
            className="select"
            value={settings.streamBitrate}
            onChange={(e) => settings.update({ streamBitrate: Number(e.target.value) })}
          >
            {BITRATES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, padding: '0 6px' }}>
            Réduisez la qualité pour économiser vos données mobiles. Les titres téléchargés sont toujours lus en local.
          </p>
        </div>
      </div>

      <div className="section-title">Téléchargements</div>
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="dlq">Format des fichiers téléchargés</label>
          <select
            id="dlq"
            className="select"
            value={settings.downloadQuality}
            onChange={(e) => settings.update({ downloadQuality: e.target.value as DownloadQuality })}
          >
            <option value="original">Fichier d'origine (meilleure qualité)</option>
            <option value="mp3">MP3 320 kb/s (plus léger, compatible partout)</option>
          </select>
        </div>
        <div className="row" style={{ marginTop: 18, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            <strong>
              {plural(dlCount, 'titre')} · {formatBytes(dlSize)}
            </strong>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {pending > 0 ? `${pending} en cours de téléchargement · ` : ''}
              {free !== null ? `${formatBytes(free)} libres sur l'appareil` : 'Stockés sur cet appareil'}
            </div>
          </div>
          <button className="btn sm danger" disabled={!dlCount && !pending} onClick={() => setConfirmClear(true)}>
            Tout supprimer
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 12, padding: '0 2px' }}>
          Les titres téléchargés sont toujours lus depuis l'appareil en priorité. Pour télécharger, utilisez l'icône ⤓ d'un album ou le menu ⋯ d'un titre.
        </p>
      </div>

      <div className="section-title">Serveur de demandes</div>
      <div className="card">
        <div className="field">
          <label htmlFor="rqurl">Adresse du serveur Soundy</label>
          <div className="input-wrap">
            <IconServer />
            <input
              id="rqurl"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={isNative() ? 'https://soundy.mondomaine.fr' : 'Même adresse que l’application'}
              value={requestsUrl}
              onChange={(e) => setRequestsUrl(e.target.value)}
              onBlur={() => settings.update({ requestsUrl: requestsUrl.trim().replace(/\/+$/, '') })}
            />
          </div>
        </div>
        <button className="btn sm" onClick={() => void testRequests()} disabled={testing}>
          {testing ? 'Test en cours…' : 'Tester la connexion'}
        </button>
      </div>

      <div style={{ marginTop: 34 }}>
        <button className="btn block danger" onClick={() => setConfirm(true)}>
          <IconLogout /> Se déconnecter
        </button>
      </div>
      <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 24 }}>
        Soundy v{APP_VERSION} · build du {__BUILD__}
      </p>

      <Sheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Supprimer les téléchargements ?"
        description={`${plural(dlCount, 'titre')} (${formatBytes(dlSize)}) seront retirés de cet appareil. Ils restent disponibles en streaming.`}
      >
        <div className="row" style={{ gap: 14 }}>
          <button className="btn block" onClick={() => setConfirmClear(false)}>
            Annuler
          </button>
          <button
            className="btn block danger"
            onClick={() => {
              void useDownloads.getState().clear();
              setConfirmClear(false);
            }}
          >
            Supprimer
          </button>
        </div>
      </Sheet>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Se déconnecter ?"
        description="Les titres téléchargés restent sur l'appareil et seront disponibles à votre prochaine connexion."
      >
        <div className="row" style={{ gap: 14 }}>
          <button className="btn block" onClick={() => setConfirm(false)}>
            Annuler
          </button>
          <button
            className="btn block danger"
            onClick={() => {
              usePlayer.getState().stop();
              clearPagedCache();
              logout();
            }}
          >
            Déconnexion
          </button>
        </div>
      </Sheet>
    </div>
  );
}
