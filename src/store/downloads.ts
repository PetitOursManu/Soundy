import { create } from 'zustand';
import type { Track } from '../api/emby';
import * as db from '../lib/db';
import type { DownloadedTrack } from '../lib/db';
import { getClient } from './auth';
import { useSettings } from './settings';
import { toast } from './toast';

export interface DownloadTask {
  track: Track;
  progress: number; // 0 → 1
  status: 'queued' | 'downloading' | 'error';
  error?: string;
}

interface DownloadsState {
  ready: boolean;
  downloaded: Record<string, DownloadedTrack>;
  tasks: DownloadTask[];
  init: () => Promise<void>;
  download: (tracks: Track[]) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (ids: string[]) => Promise<void>;
  clear: () => Promise<void>;
}

const MAX_PARALLEL = 2;
const controllers = new Map<string, AbortController>();
let persistAsked = false;

export const useDownloads = create<DownloadsState>((set, get) => {
  const patchTask = (id: string, patch: Partial<DownloadTask>) =>
    set({ tasks: get().tasks.map((t) => (t.track.id === id ? { ...t, ...patch } : t)) });

  const pump = () => {
    const { tasks } = get();
    const running = tasks.filter((t) => t.status === 'downloading').length;
    const next = tasks.filter((t) => t.status === 'queued').slice(0, Math.max(0, MAX_PARALLEL - running));
    next.forEach((t) => void run(t.track));
  };

  const finish = (id: string) => {
    controllers.delete(id);
    set({ tasks: get().tasks.filter((t) => t.track.id !== id) });
    pump();
  };

  async function run(track: Track) {
    const client = getClient();
    if (!client) return;
    patchTask(track.id, { status: 'downloading', progress: 0, error: undefined });
    const ctrl = new AbortController();
    controllers.set(track.id, ctrl);
    try {
      const quality = useSettings.getState().downloadQuality;
      const res = await fetch(client.downloadUrl(track.id, quality), { signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status === 403 ? 'Téléchargement non autorisé par Emby' : `Erreur ${res.status}`);

      // Lecture en flux pour afficher la progression
      const total = Number(res.headers.get('Content-Length')) || track.duration * (quality === 'mp3' ? 40_000 : 120_000);
      const reader = res.body?.getReader();
      let blob: Blob;
      if (reader) {
        const chunks: BlobPart[] = [];
        let received = 0;
        let lastUpdate = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const now = performance.now();
          if (now - lastUpdate > 200) {
            lastUpdate = now;
            patchTask(track.id, { progress: Math.min(0.99, received / total) });
          }
        }
        blob = new Blob(chunks, { type: res.headers.get('Content-Type') || 'audio/mpeg' });
      } else {
        blob = await res.blob();
      }

      // Pochette (une seule fois par album)
      if (track.imageId && !(await db.hasCover(track.imageId))) {
        const url = client.imageUrl(track.imageId, track.imageTag, 600);
        if (url) {
          try {
            const r = await fetch(url);
            if (r.ok) await db.saveCover(track.imageId, await r.blob());
          } catch {
            /* pochette facultative */
          }
        }
      }

      const meta: DownloadedTrack = { ...track, size: blob.size, mime: blob.type, downloadedAt: Date.now() };
      await db.saveTrack(meta, blob);
      set({ downloaded: { ...get().downloaded, [track.id]: meta } });
      finish(track.id);
    } catch (e) {
      controllers.delete(track.id);
      if (ctrl.signal.aborted) return;
      const msg =
        e instanceof DOMException && e.name === 'QuotaExceededError'
          ? 'Espace de stockage insuffisant'
          : (e as Error).message || 'Échec du téléchargement';
      patchTask(track.id, { status: 'error', error: msg });
      toast(`${track.title} : ${msg}`, 'error');
      pump();
    }
  }

  return {
    ready: false,
    downloaded: {},
    tasks: [],

    init: async () => {
      try {
        const all = await db.getAllMeta();
        set({ downloaded: Object.fromEntries(all.map((t) => [t.id, t])), ready: true });
      } catch {
        set({ ready: true });
      }
    },

    download: (tracks) => {
      const { downloaded, tasks } = get();
      const fresh = tracks.filter((t) => !downloaded[t.id] && !tasks.some((x) => x.track.id === t.id));
      if (!fresh.length) {
        toast('Déjà téléchargé', 'info');
        return;
      }
      if (!persistAsked) {
        persistAsked = true;
        navigator.storage?.persist?.().catch(() => {});
      }
      set({ tasks: [...tasks, ...fresh.map((track) => ({ track, progress: 0, status: 'queued' as const }))] });
      toast(fresh.length > 1 ? `${fresh.length} titres ajoutés aux téléchargements` : `Téléchargement de « ${fresh[0].title} »`);
      pump();
    },

    cancel: (id) => {
      controllers.get(id)?.abort();
      finish(id);
    },

    retry: (id) => {
      patchTask(id, { status: 'queued', progress: 0, error: undefined });
      pump();
    },

    remove: async (ids) => {
      const downloaded = { ...get().downloaded };
      const imageIds = new Set<string>();
      for (const id of ids) {
        const t = downloaded[id];
        if (t?.imageId) imageIds.add(t.imageId);
        await db.deleteTrack(id);
        delete downloaded[id];
      }
      // Supprime les pochettes qui ne servent plus
      const used = new Set(Object.values(downloaded).map((t) => t.imageId));
      for (const img of imageIds) if (!used.has(img)) await db.deleteCover(img);
      set({ downloaded });
    },

    clear: async () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
      await db.clearAll();
      set({ downloaded: {}, tasks: [] });
    },
  };
});

/** État de téléchargement d'un ensemble de titres (album par ex.). */
export function useDownloadState(ids: string[]) {
  return useDownloads((s) => {
    if (!ids.length) return { done: 0, pending: 0, total: 0, progress: 0 };
    let done = 0;
    let pending = 0;
    let progress = 0;
    for (const id of ids) {
      if (s.downloaded[id]) {
        done++;
        progress += 1;
      } else {
        const t = s.tasks.find((x) => x.track.id === id);
        if (t && t.status !== 'error') {
          pending++;
          progress += t.progress;
        }
      }
    }
    return { done, pending, total: ids.length, progress: progress / ids.length };
  }, shallowEqual);
}

function shallowEqual<T extends Record<string, number>>(a: T, b: T) {
  return Object.keys(a).every((k) => a[k] === b[k]);
}
