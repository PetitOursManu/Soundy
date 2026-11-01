// Client du serveur de demandes Soundy (voir /server).
import type { Session } from './emby';
import { currentLang, t } from '../i18n';

export type RequestType = 'album' | 'tracks';
export type RequestStatus = 'pending' | 'added' | 'refused';

export interface MusicRequest {
  id: string;
  type: RequestType;
  artist: string;
  album?: string;
  tracks: string[];
  comment?: string;
  status: RequestStatus;
  adminNote?: string;
  userId: string;
  userName: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewRequest {
  type: RequestType;
  artist: string;
  album?: string;
  tracks: string[];
  comment?: string;
}

export class RequestsApi {
  constructor(private base: string, private session: Session) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = this.base.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/api${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Token': this.session.token,
          'X-Emby-UserId': this.session.userId,
          'Accept-Language': currentLang(),
          ...init.headers,
        },
      });
    } catch {
      throw new Error(t('requests.unreachable'));
    }
    // Une page HTML (et non du JSON) = ce n'est pas le serveur Soundy à cette adresse
    const isJson = (res.headers.get('Content-Type') || '').includes('application/json');
    if (!isJson) throw new Error(t('requests.notSoundy'));
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || t('requests.error', { status: res.status }));
    return data as T;
  }

  async list(scope: 'mine' | 'all') {
    const data = await this.call<MusicRequest[]>(`/requests?scope=${scope}`);
    if (!Array.isArray(data)) throw new Error(t('requests.unexpected'));
    return data;
  }

  create(req: NewRequest) {
    return this.call<MusicRequest>('/requests', { method: 'POST', body: JSON.stringify(req) });
  }

  update(id: string, patch: { status: RequestStatus; adminNote?: string }) {
    return this.call<MusicRequest>(`/requests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  /** Notifications admin : configurées ? pour quel service ? */
  notifyStatus() {
    return this.call<{ configured: boolean; type: string | null }>('/notify/status');
  }

  /** Envoie une notification de test (admin). */
  notifyTest() {
    return this.call<{ ok: true; type: string }>('/notify/test', { method: 'POST' });
  }

  remove(id: string) {
    return this.call<{ ok: true }>(`/requests/${id}`, { method: 'DELETE' });
  }
}
