// Client minimal pour l'API Emby.
// Documentation : https://dev.emby.media/doc/restapi/index.html

export const APP_NAME = 'Soundy';
export const APP_VERSION = '1.0.0';

export interface Session {
  server: string; // URL de base d'Emby, sans "/" final (ex : https://music.exemple.fr ou https://exemple.fr/emby)
  userId: string;
  userName: string;
  token: string;
  isAdmin: boolean;
  deviceId: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  albumArtist?: string;
  duration: number; // secondes
  index?: number;
  disc?: number;
  imageId?: string; // item portant la pochette (le titre ou son album)
  imageTag?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year?: number;
  trackCount?: number;
  imageTag?: string;
  coverId?: string; // item portant la pochette, si différent de l'album
}

interface EmbyItem {
  Id: string;
  Name: string;
  Type: string;
  AlbumArtist?: string;
  Artists?: string[];
  Album?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  ImageTags?: { Primary?: string };
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  ChildCount?: number;
  SongCount?: number;
}

interface ItemsResponse {
  Items: EmbyItem[];
  TotalRecordCount: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export type SortKey = 'name' | 'artist' | 'recent' | 'year';

export class EmbyError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

export function getDeviceId(): string {
  let id = localStorage.getItem('soundy.deviceId');
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g, '');
    localStorage.setItem('soundy.deviceId', id);
  }
  return id;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Soundy Android';
  if (/iphone|ipad/i.test(ua)) return 'Soundy iOS';
  return 'Soundy Web';
}

function authHeader(deviceId: string, token?: string): string {
  const parts = [
    `Client="${APP_NAME}"`,
    `Device="${deviceName()}"`,
    `DeviceId="${deviceId}"`,
    `Version="${APP_VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/web(\/index\.html)?$/i, '');
  return url;
}

const ticksToSeconds = (ticks?: number) => (ticks ? Math.round(ticks / 10_000_000) : 0);

function toTrack(i: EmbyItem): Track {
  const hasOwnImage = !!i.ImageTags?.Primary;
  return {
    id: i.Id,
    title: i.Name,
    artist: i.Artists?.length ? i.Artists.join(', ') : i.AlbumArtist || 'Artiste inconnu',
    albumArtist: i.AlbumArtist,
    album: i.Album || '',
    albumId: i.AlbumId,
    duration: ticksToSeconds(i.RunTimeTicks),
    index: i.IndexNumber,
    disc: i.ParentIndexNumber,
    imageId: hasOwnImage ? i.Id : i.AlbumPrimaryImageTag ? i.AlbumId : undefined,
    imageTag: hasOwnImage ? i.ImageTags!.Primary : i.AlbumPrimaryImageTag,
  };
}

function toAlbum(i: EmbyItem): Album {
  return {
    id: i.Id,
    title: i.Name,
    artist: i.AlbumArtist || i.Artists?.[0] || 'Artistes divers',
    year: i.ProductionYear,
    trackCount: i.ChildCount ?? i.SongCount,
    imageTag: i.ImageTags?.Primary,
  };
}

const SORTS: Record<SortKey, string> = {
  name: 'SortName',
  artist: 'AlbumArtist,SortName',
  recent: 'DateCreated,SortName',
  year: 'ProductionYear,SortName',
};

const TRACK_FIELDS = 'Artists,AlbumArtist,Album,AlbumId,AlbumPrimaryImageTag,RunTimeTicks,IndexNumber,ParentIndexNumber';
const ALBUM_FIELDS = 'AlbumArtist,Artists,ProductionYear,ChildCount,SongCount';

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

async function probe(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/System/Info/Public`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data && (data.Id || data.ServerName));
  } catch {
    return false;
  }
}

/** Trouve l'URL réelle du serveur (avec ou sans le préfixe /emby). */
export async function resolveServer(input: string): Promise<string> {
  const base = normalizeServerUrl(input);
  if (await probe(base)) return base;
  if (!/\/emby$/i.test(base) && (await probe(`${base}/emby`))) return `${base}/emby`;
  throw new EmbyError(
    "Impossible de joindre le serveur Emby. Vérifiez l'adresse (et que le serveur autorise les requêtes CORS).",
  );
}

export async function login(serverInput: string, username: string, password: string): Promise<Session> {
  const server = await resolveServer(serverInput);
  const deviceId = getDeviceId();
  const res = await fetch(`${server}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': authHeader(deviceId),
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });
  if (res.status === 401 || res.status === 403) throw new EmbyError('Identifiant ou mot de passe incorrect.', res.status);
  if (!res.ok) throw new EmbyError(`Erreur du serveur (${res.status}).`, res.status);
  const data = await res.json();
  return {
    server,
    deviceId,
    token: data.AccessToken,
    userId: data.User.Id,
    userName: data.User.Name,
    isAdmin: !!data.User.Policy?.IsAdministrator,
  };
}

// ---------------------------------------------------------------------------
// Client authentifié
// ---------------------------------------------------------------------------

export class EmbyClient {
  constructor(public session: Session) {}

  private headers(): HeadersInit {
    return {
      'X-Emby-Authorization': authHeader(this.session.deviceId, this.session.token),
      'X-Emby-Token': this.session.token,
    };
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.session.server}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
    if (res.status === 401) throw new EmbyError('Session expirée, veuillez vous reconnecter.', 401);
    if (!res.ok) throw new EmbyError(`Erreur Emby (${res.status})`, res.status);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private items(params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return this.request<ItemsResponse>(`/Users/${this.session.userId}/Items?${qs}`, { signal });
  }

  async getAlbums(opts: { start?: number; limit?: number; sort?: SortKey; signal?: AbortSignal } = {}): Promise<Page<Album>> {
    const sort = opts.sort ?? 'name';
    const r = await this.items(
      {
        IncludeItemTypes: 'MusicAlbum',
        Recursive: true,
        SortBy: SORTS[sort],
        SortOrder: sort === 'recent' || sort === 'year' ? 'Descending' : 'Ascending',
        Fields: ALBUM_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary',
        StartIndex: opts.start ?? 0,
        Limit: opts.limit ?? 60,
      },
      opts.signal,
    );
    return { items: r.Items.map(toAlbum), total: r.TotalRecordCount };
  }

  async getTracks(opts: { start?: number; limit?: number; sort?: SortKey; signal?: AbortSignal } = {}): Promise<Page<Track>> {
    const sort = opts.sort ?? 'name';
    const sortBy = sort === 'artist' ? 'Artist,Album,ParentIndexNumber,IndexNumber' : SORTS[sort];
    const r = await this.items(
      {
        IncludeItemTypes: 'Audio',
        Recursive: true,
        SortBy: sortBy,
        SortOrder: sort === 'recent' || sort === 'year' ? 'Descending' : 'Ascending',
        Fields: TRACK_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary',
        StartIndex: opts.start ?? 0,
        Limit: opts.limit ?? 100,
      },
      opts.signal,
    );
    return { items: r.Items.map(toTrack), total: r.TotalRecordCount };
  }

  async getAlbum(id: string): Promise<Album> {
    const item = await this.request<EmbyItem>(`/Users/${this.session.userId}/Items/${id}`);
    return toAlbum(item);
  }

  async getAlbumTracks(albumId: string): Promise<Track[]> {
    const r = await this.items({
      ParentId: albumId,
      IncludeItemTypes: 'Audio',
      Recursive: true,
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
      Fields: TRACK_FIELDS,
    });
    return r.Items.map(toTrack);
  }

  async getRandomTracks(limit = 100): Promise<Track[]> {
    const r = await this.items({
      IncludeItemTypes: 'Audio',
      Recursive: true,
      SortBy: 'Random',
      Fields: TRACK_FIELDS,
      Limit: limit,
    });
    return r.Items.map(toTrack);
  }

  async search(term: string, signal?: AbortSignal): Promise<{ albums: Album[]; tracks: Track[] }> {
    const [albums, tracks] = await Promise.all([
      this.items(
        { SearchTerm: term, IncludeItemTypes: 'MusicAlbum', Recursive: true, Fields: ALBUM_FIELDS, Limit: 30, ImageTypeLimit: 1 },
        signal,
      ),
      this.items(
        { SearchTerm: term, IncludeItemTypes: 'Audio', Recursive: true, Fields: TRACK_FIELDS, Limit: 60, ImageTypeLimit: 1 },
        signal,
      ),
    ]);
    return { albums: albums.Items.map(toAlbum), tracks: tracks.Items.map(toTrack) };
  }

  /** URL d'une pochette. */
  imageUrl(itemId: string | undefined, tag?: string, size = 400): string | undefined {
    if (!itemId) return undefined;
    const qs = new URLSearchParams({ maxWidth: String(size), maxHeight: String(size), quality: '90' });
    if (tag) qs.set('tag', tag);
    return `${this.session.server}/Items/${itemId}/Images/Primary?${qs}`;
  }

  /**
   * URL de streaming « universelle » : Emby envoie le fichier tel quel si le
   * navigateur sait le lire, sinon il le transcode en MP3.
   */
  streamUrl(trackId: string, maxBitrate: number): string {
    const qs = new URLSearchParams({
      UserId: this.session.userId,
      DeviceId: this.session.deviceId,
      api_key: this.session.token,
      MaxStreamingBitrate: String(maxBitrate),
      Container: 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg',
      TranscodingContainer: 'mp3',
      TranscodingProtocol: 'http',
      AudioCodec: 'mp3',
      MaxSampleRate: '48000',
    });
    return `${this.session.server}/Audio/${trackId}/universal?${qs}`;
  }

  /** URL de téléchargement : fichier d'origine ou MP3 320 kb/s. */
  downloadUrl(trackId: string, quality: 'original' | 'mp3'): string {
    const token = encodeURIComponent(this.session.token);
    if (quality === 'mp3') {
      return `${this.session.server}/Audio/${trackId}/stream.mp3?AudioCodec=mp3&AudioBitRate=320000&api_key=${token}`;
    }
    return `${this.session.server}/Audio/${trackId}/stream?static=true&api_key=${token}`;
  }

  // --- Rapport de lecture (affiché dans le tableau de bord Emby) ---------

  reportStart(trackId: string, playSessionId: string, method: 'DirectStream' | 'DirectPlay') {
    return this.request('/Sessions/Playing', {
      method: 'POST',
      body: JSON.stringify({ ItemId: trackId, PlaySessionId: playSessionId, PlayMethod: method, CanSeek: true }),
    }).catch(() => {});
  }

  reportProgress(trackId: string, playSessionId: string, seconds: number, paused: boolean) {
    return this.request('/Sessions/Playing/Progress', {
      method: 'POST',
      body: JSON.stringify({
        ItemId: trackId,
        PlaySessionId: playSessionId,
        PositionTicks: Math.round(seconds * 10_000_000),
        IsPaused: paused,
        EventName: 'TimeUpdate',
      }),
    }).catch(() => {});
  }

  reportStopped(trackId: string, playSessionId: string, seconds: number) {
    return this.request('/Sessions/Playing/Stopped', {
      method: 'POST',
      body: JSON.stringify({ ItemId: trackId, PlaySessionId: playSessionId, PositionTicks: Math.round(seconds * 10_000_000) }),
    }).catch(() => {});
  }

  logout() {
    return this.request('/Sessions/Logout', { method: 'POST' }).catch(() => {});
  }
}
