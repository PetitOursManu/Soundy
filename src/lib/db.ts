// Stockage local des musiques téléchargées (IndexedDB).
// - "meta"   : informations des titres (légères, chargées au démarrage)
// - "audio"  : fichiers audio (Blob)
// - "covers" : pochettes (Blob), indexées par l'id de l'item image
import { openDB, IDBPDatabase } from 'idb';
import type { Track } from '../api/emby';

export interface DownloadedTrack extends Track {
  size: number;
  mime: string;
  downloadedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB('soundy', 1, {
      upgrade(d) {
        d.createObjectStore('meta', { keyPath: 'id' });
        d.createObjectStore('audio');
        d.createObjectStore('covers');
      },
    });
  }
  return dbPromise;
}

export async function getAllMeta(): Promise<DownloadedTrack[]> {
  return (await db()).getAll('meta');
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  return (await db()).get('audio', id);
}

export async function saveTrack(meta: DownloadedTrack, blob: Blob) {
  const d = await db();
  const tx = d.transaction(['meta', 'audio'], 'readwrite');
  await Promise.all([tx.objectStore('audio').put(blob, meta.id), tx.objectStore('meta').put(meta), tx.done]);
}

export async function deleteTrack(id: string) {
  const d = await db();
  const tx = d.transaction(['meta', 'audio'], 'readwrite');
  await Promise.all([tx.objectStore('audio').delete(id), tx.objectStore('meta').delete(id), tx.done]);
}

export async function getCover(id: string): Promise<Blob | undefined> {
  return (await db()).get('covers', id);
}

export async function hasCover(id: string): Promise<boolean> {
  return !!(await (await db()).getKey('covers', id));
}

export async function saveCover(id: string, blob: Blob) {
  await (await db()).put('covers', blob, id);
}

export async function deleteCover(id: string) {
  await (await db()).delete('covers', id);
}

export async function clearAll() {
  const d = await db();
  const tx = d.transaction(['meta', 'audio', 'covers'], 'readwrite');
  await Promise.all([tx.objectStore('meta').clear(), tx.objectStore('audio').clear(), tx.objectStore('covers').clear(), tx.done]);
}
