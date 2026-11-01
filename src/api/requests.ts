// Client du serveur de demandes Soundy (voir /server).
import type { Session } from './emby';

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
          ...init.headers,
        },
      });
    } catch {
      throw new Error('Serveur de demandes injoignable.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data as T;
  }

  list(scope: 'mine' | 'all') {
    return this.call<MusicRequest[]>(`/requests?scope=${scope}`);
  }

  create(req: NewRequest) {
    return this.call<MusicRequest>('/requests', { method: 'POST', body: JSON.stringify(req) });
  }

  update(id: string, patch: { status: RequestStatus; adminNote?: string }) {
    return this.call<MusicRequest>(`/requests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  remove(id: string) {
    return this.call<{ ok: true }>(`/requests/${id}`, { method: 'DELETE' });
  }
}
