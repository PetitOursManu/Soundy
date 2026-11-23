// Accès à Soundy décidé par le serveur Soundy (GET /api/me) : un compte géré par Kosmy Board peut y avoir
// un autre rôle que dans Emby, ou avoir perdu l'accès (403 « account_disabled »).
// Le serveur Soundy est facultatif (version Android sans serveur de demandes) : sans réponse, rien ne change.
import type { Session } from './emby';
import { currentLang } from '../i18n';

export type Access = { isAdmin: boolean } | 'disabled' | null;

/** `base` : adresse du serveur Soundy (vide = même origine que l'appli). */
export async function checkAccess(base: string, session: Session): Promise<Access> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/me`, {
      headers: { 'X-Emby-Token': session.token, 'X-Emby-UserId': session.userId, 'Accept-Language': currentLang() },
      signal: AbortSignal.timeout(8000),
    });
    // Une page HTML (et non du JSON) = pas de serveur Soundy à cette adresse.
    if (!(res.headers.get('Content-Type') || '').includes('application/json')) return null;
    const data = await res.json().catch(() => null);
    if (res.status === 403 && data?.code === 'account_disabled') return 'disabled';
    if (!res.ok || typeof data?.isAdmin !== 'boolean') return null;
    return { isAdmin: data.isAdmin };
  } catch {
    return null;
  }
}
