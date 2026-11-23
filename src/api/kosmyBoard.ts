// Kosmy Board : « Se connecter avec Kosmy Board », lien du compte et réglages (voir server/kosmy-board.js).
// Version web seulement : le parcours passe par le serveur Soundy qui sert l'application (même origine).
import { getDeviceId, Session } from './emby';
import { currentLang, detectLang, Key, t } from '../i18n';
import { isNative } from '../lib/native';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';

export const LOGIN_URL = '/auth/kosmy-board/login';

export interface BoardAccount {
  sub: string;
  name: string;
  email: string;
  embyUserName: string;
  linkedAt: string;
  lastLogin: string;
}

export interface BoardSettings {
  issuer: string;
  clientId: string;
  secretSet: boolean;
  enabled: boolean;
  redirectUri: string;
  loginUri: string;
  accounts: number;
}

/** La connexion par le Board est-elle proposée par ce serveur ? */
export async function boardEnabled(): Promise<boolean> {
  if (isNative()) return false;
  try {
    const res = await fetch('/api/auth/kosmy-board', { signal: AbortSignal.timeout(6000) });
    if (!res.ok || !(res.headers.get('Content-Type') || '').includes('application/json')) return false;
    return !!(await res.json()).enabled;
  } catch {
    return false;
  }
}

async function call<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Token': session.token,
        'X-Emby-UserId': session.userId,
        'Accept-Language': currentLang(),
        ...init.headers,
      },
    });
  } catch {
    throw new Error(t('requests.unreachable'));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || t('requests.error', { status: res.status }));
  return data as T;
}

export const boardApi = {
  me: (s: Session) => call<{ enabled: boolean; account: BoardAccount | null }>(s, '/kosmy-board/me'),
  link: (s: Session, password: string) =>
    call<{ url: string }>(s, '/kosmy-board/link', { method: 'POST', body: JSON.stringify({ password, server: s.server }) }),
  unlink: (s: Session) => call<{ ok: true }>(s, '/kosmy-board/me', { method: 'DELETE' }),
  settings: (s: Session) => call<BoardSettings>(s, '/kosmy-board/settings'),
  saveSettings: (s: Session, body: { issuer: string; clientId: string; secret?: string }) =>
    call<BoardSettings>(s, '/kosmy-board/settings', { method: 'PUT', body: JSON.stringify(body) }),
};

const ERRORS: Record<string, Key> = {
  not_linked: 'kb.error.notLinked',
  expired: 'kb.error.expired',
  disabled_account: 'access.disabled',
  denied: 'kb.error.denied',
  state: 'kb.error.state',
  issuer: 'kb.error.issuer',
  disabled: 'kb.error.disabled',
  unreachable: 'kb.error.unreachable',
};

/**
 * Au démarrage : retour du Board (?kb=1, ?kb=linked ou ?kb_error=…).
 * Avec ?kb=1, le serveur a posé un ticket à usage unique, échangé ici contre la session Emby reliée.
 */
export async function handleBoardReturn(): Promise<void> {
  if (isNative()) return;
  const url = new URL(window.location.href);
  const kb = url.searchParams.get('kb');
  const error = url.searchParams.get('kb_error');
  if (!kb && !error) return;
  url.searchParams.delete('kb');
  url.searchParams.delete('kb_error');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

  if (!useSettings.getState().language) useSettings.getState().update({ language: detectLang() });
  if (error) return void toast(t(ERRORS[error] ?? 'kb.error.failed'), 'error');
  if (kb === 'linked') return void toast(t('kb.linked'), 'success');
  if (kb !== '1') return;

  try {
    const res = await fetch('/api/kosmy-board/session', { method: 'POST', headers: { 'Accept-Language': currentLang() } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.token) return void toast(t(ERRORS[data?.error] ?? 'kb.error.failed'), 'error');
    const auth = useAuth.getState();
    // Déjà connecté avec ce compte : on garde la session en cours.
    if (auth.session?.userId === data.userId) return;
    if (auth.session) auth.logout();
    auth.setSession({
      server: data.server,
      userId: data.userId,
      userName: data.userName,
      token: data.token,
      isAdmin: !!data.isAdmin,
      deviceId: getDeviceId(),
      via: 'kosmy-board',
    });
  } catch {
    toast(t('kb.error.failed'), 'error');
  }
}
