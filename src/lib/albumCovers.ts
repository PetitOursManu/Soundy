// Pochettes des albums qui n'ont pas d'image propre dans Emby (image intégrée
// aux fichiers des titres seulement) : on va chercher celle d'un titre, une
// seule fois, avec un résultat mémorisé sur l'appareil.
import { useEffect, useState } from 'react';
import type { Album } from '../api/emby';
import { getClient } from '../store/auth';

type Found = { imageId: string; tag?: string } | null;
const KEY = 'soundy.albumCovers';

let cache: Record<string, Found> = {};
try {
  cache = JSON.parse(localStorage.getItem(KEY) || '{}');
} catch {
  cache = {};
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* stockage plein : sans gravité */
    }
  }, 500);
}

// File d'attente : 4 recherches en parallèle au maximum
const waiting: { id: string; resolve: (f: Found) => void }[] = [];
const inFlight = new Map<string, Promise<Found>>();
let running = 0;

function pump() {
  while (running < 4 && waiting.length) {
    const job = waiting.shift()!;
    running++;
    const client = getClient();
    (client ? client.findAlbumCover(job.id) : Promise.resolve(null))
      .catch(() => undefined)
      .then((found) => {
        if (found !== undefined) {
          cache[job.id] = found;
          save();
        }
        job.resolve(found ?? null);
      })
      .finally(() => {
        running--;
        inFlight.delete(job.id);
        pump();
      });
  }
}

function lookup(id: string): Promise<Found> {
  if (id in cache) return Promise.resolve(cache[id]);
  let p = inFlight.get(id);
  if (!p) {
    p = new Promise<Found>((resolve) => waiting.push({ id, resolve }));
    inFlight.set(id, p);
    pump();
  }
  return p;
}

/** Image à afficher pour un album (la sienne, ou celle d'un de ses titres). */
export function useAlbumCover(album: Album): { imageId?: string; tag?: string } {
  const own = album.coverId ?? (album.imageTag ? album.id : undefined);
  const ids = album.ids ?? [album.id];
  const cached = ids.map((id) => cache[id]).find(Boolean);
  const [found, setFound] = useState<Found | undefined>(own ? undefined : cached);

  useEffect(() => {
    if (own || found || ids[0].startsWith('single-')) return;
    let alive = true;
    (async () => {
      for (const id of ids) {
        const f = await lookup(id);
        if (f) {
          if (alive) setFound(f);
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, ids.join(',')]);

  if (own) return { imageId: own, tag: album.imageTag };
  return found ? { imageId: found.imageId, tag: found.tag } : {};
}
