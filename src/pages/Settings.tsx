import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../api/emby';
import { RequestsApi } from '../api/requests';
import { Brand } from '../components/Brand';
import { IconBack, IconLogout, IconServer } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Sheet } from '../components/Sheet';
import { Key, useT } from '../i18n';
import { formatBytes } from '../lib/format';
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
  const { t, tn, lang } = useT();
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
      toast(t('settings.reachable'), 'success');
    } catch {
      toast(t('settings.unreachable'), 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconBack />
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>{t('settings.title')}</h1>
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

      <div className="section-title">{t('settings.language')}</div>
      <Segmented<'fr' | 'en'>
        label={t('settings.language')}
        value={lang}
        onChange={(language) => settings.update({ language })}
        options={[
          { value: 'fr', label: '🇫🇷 Français' },
          { value: 'en', label: '🇬🇧 English' },
        ]}
      />

      <div className="section-title">{t('settings.appearance')}</div>
      <Segmented<Theme>
        label={t('settings.theme')}
        value={settings.theme}
        onChange={(theme) => settings.update({ theme })}
        options={[
          { value: 'auto', label: t('settings.themeAuto') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
        ]}
      />

      <div className="section-title">{t('settings.vibrations')}</div>
      <button
        className="card row"
        style={{ width: '100%', justifyContent: 'space-between', textAlign: 'left' }}
        onClick={() => settings.update({ haptics: !settings.haptics })}
        aria-pressed={settings.haptics}
      >
        <span>
          <strong style={{ fontSize: 15 }}>{t('settings.vibrationsTitle')}</strong>
          <span className="muted" style={{ display: 'block', fontSize: 12.5, marginTop: 3 }}>
            {t('settings.vibrationsHint')}
          </span>
        </span>
        <span className={`switch ${settings.haptics ? 'on' : ''}`} />
      </button>

      <div className="section-title">{t('settings.playback')}</div>
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bitrate">{t('settings.streamQuality')}</label>
          <select
            id="bitrate"
            className="select"
            value={settings.streamBitrate}
            onChange={(e) => settings.update({ streamBitrate: Number(e.target.value) })}
          >
            {BITRATES.map((b) => (
              <option key={b.value} value={b.value}>
                {t(b.label as Key)}
              </option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, padding: '0 6px' }}>
            {t('settings.streamHint')}
          </p>
        </div>
      </div>

      <div className="section-title">{t('settings.downloads')}</div>
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="dlq">{t('settings.downloadFormat')}</label>
          <select
            id="dlq"
            className="select"
            value={settings.downloadQuality}
            onChange={(e) => settings.update({ downloadQuality: e.target.value as DownloadQuality })}
          >
            <option value="original">{t('settings.formatOriginal')}</option>
            <option value="mp3">{t('settings.formatMp3')}</option>
          </select>
        </div>
        <div className="row" style={{ marginTop: 18, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            <strong>
              {tn('common.tracks', dlCount)} · {formatBytes(dlSize)}
            </strong>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {pending > 0 ? t('settings.inProgress', { n: pending }) : ''}
              {free !== null ? t('settings.free', { size: formatBytes(free) }) : t('settings.storedHere')}
            </div>
          </div>
          <button className="btn sm danger" disabled={!dlCount && !pending} onClick={() => setConfirmClear(true)}>
            {t('settings.deleteAll')}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 12, padding: '0 2px' }}>
          {t('settings.downloadsHint')}
        </p>
      </div>

      {session.isAdmin && (
        <>
          <div className="section-title">{t('notify.section')}</div>
          <NotifySettings requestsUrl={settings.requestsUrl} />
        </>
      )}

      <div className="section-title">{t('settings.requestsServer')}</div>
      <div className="card">
        <div className="field">
          <label htmlFor="rqurl">{t('settings.requestsAddress')}</label>
          <div className="input-wrap">
            <IconServer />
            <input
              id="rqurl"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={isNative() ? 'https://soundy.example.com' : t('settings.sameAddress')}
              value={requestsUrl}
              onChange={(e) => setRequestsUrl(e.target.value)}
              onBlur={() => settings.update({ requestsUrl: requestsUrl.trim().replace(/\/+$/, '') })}
            />
          </div>
        </div>
        <button className="btn sm" onClick={() => void testRequests()} disabled={testing}>
          {testing ? t('settings.testing') : t('settings.test')}
        </button>
      </div>

      <div style={{ marginTop: 34 }}>
        <button className="btn block danger" onClick={() => setConfirm(true)}>
          <IconLogout /> {t('settings.logout')}
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 30 }}>
        <Brand size={34} />
      </div>
      <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 10 }}>
        {t('settings.version', { version: APP_VERSION, build: __BUILD__ })}
      </p>

      <Sheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('settings.clearTitle')}
        description={t('settings.clearText', { tracks: tn('common.tracks', dlCount), size: formatBytes(dlSize) })}
      >
        <div className="row" style={{ gap: 14 }}>
          <button className="btn block" onClick={() => setConfirmClear(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn block danger"
            onClick={() => {
              void useDownloads.getState().clear();
              setConfirmClear(false);
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('settings.logoutTitle')}
        description={t('settings.logoutText')}
      >
        <div className="row" style={{ gap: 14 }}>
          <button className="btn block" onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn block danger"
            onClick={() => {
              usePlayer.getState().stop();
              clearPagedCache();
              logout();
            }}
          >
            {t('settings.logoutButton')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

const SERVICE_NAMES: Record<string, string> = { discord: 'Discord', slack: 'Slack / Mattermost', gotify: 'Gotify', ntfy: 'ntfy', json: 'Webhook' };

/** Administrateurs : état des notifications de demandes + envoi d'un test. */
function NotifySettings({ requestsUrl }: { requestsUrl: string }) {
  const { t } = useT();
  const session = useAuth((s) => s.session)!;
  const api = useMemo(() => new RequestsApi(requestsUrl, session), [requestsUrl, session]);
  const [status, setStatus] = useState<{ configured: boolean; type: string | null } | null | 'error'>(null);
  const [errMsg, setErrMsg] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .notifyStatus()
      .then((st) => alive && setStatus(st))
      .catch((e) => {
        if (!alive) return;
        setErrMsg((e as Error).message);
        setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const test = async () => {
    setSending(true);
    try {
      await api.notifyTest();
      toast(t('notify.sent'), 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const configured = status !== 'error' && !!status?.configured;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 15 }}>{t('notify.title')}</strong>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {status === 'error'
              ? `${t('notify.unavailable')} : ${errMsg}`
              : status === null
                ? '…'
                : configured
                  ? t('notify.on', { service: SERVICE_NAMES[status.type ?? 'json'] ?? status.type ?? '' })
                  : t('notify.off')}
          </div>
        </div>
        <span className={`badge ${configured ? 'added' : 'pending'}`}>{configured ? 'ON' : 'OFF'}</span>
      </div>
      {!configured && status !== null && (
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 12 }}>
          {status === 'error' ? t('notify.checkServer', { url: `${(requestsUrl || window.location.origin).replace(/\/+$/, '')}/api/health` }) : t('notify.help')}
        </p>
      )}
      <button className="btn sm" style={{ marginTop: 14 }} disabled={!configured || sending} onClick={() => void test()}>
        {sending ? t('notify.sending') : t('notify.test')}
      </button>
    </div>
  );
}
