// Regroupement des albums « éclatés » par Emby.
// Emby crée un album distinct dès que l'« artiste de l'album » diffère d'une
// piste à l'autre (ex. « Ed Sheeran » / « Ed Sheeran feat. Wiley ») : on se
// retrouve avec des albums d'un seul titre. On les réunit ici quand ils ont
// le même nom ET un artiste en commun (ou la même année : compilations).
import type { Album } from '../api/emby';

export const normName = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const SEPARATORS = /\s*(?:,|&|;|\/|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i;
const VARIOUS = new Set(['various artists', 'various', 'artistes divers', 'artistes variés', 'divers', 'va', 'compilation']);

export function artistTokens(s?: string): string[] {
  return normName(s)
    .split(SEPARATORS)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function sameAlbum(a: Pick<Album, 'title' | 'artist' | 'year'>, b: Pick<Album, 'title' | 'artist' | 'year'>): boolean {
  if (normName(a.title) !== normName(b.title)) return false;
  const ta = artistTokens(a.artist);
  const tb = artistTokens(b.artist);
  if (ta.some((t) => tb.includes(t))) return true;
  if (ta.some((t) => VARIOUS.has(t)) || tb.some((t) => VARIOUS.has(t))) return true;
  return !!a.year && a.year === b.year;
}

/** Fusionne les albums identiques d'une liste (l'ordre est conservé). */
export function mergeAlbums(list: Album[]): Album[] {
  const out: Album[] = [];
  const byName = new Map<string, Album[]>();
  for (const a of list) {
    const key = normName(a.title);
    const group = byName.get(key) ?? [];
    const target = group.find((g) => sameAlbum(g, a));
    if (target) {
      target.ids = [...(target.ids ?? [target.id]), a.id];
      target.trackCount = (target.trackCount ?? 0) + (a.trackCount ?? 0);
      if (!target.imageTag && a.imageTag) {
        target.coverId = a.id;
        target.imageTag = a.imageTag;
      }
      // On garde le nom d'artiste le plus simple (« Ed Sheeran » plutôt que « Ed Sheeran feat. … »)
      if (a.artist.length < target.artist.length) target.artist = a.artist;
      if (!target.year && a.year) target.year = a.year;
    } else {
      const copy: Album = { ...a, ids: [a.id] };
      group.push(copy);
      byName.set(key, group);
      out.push(copy);
    }
  }
  return out;
}

/** Adresse de la page d'un album (plusieurs identifiants Emby si fusionné). */
export const albumPath = (a: Album) => `/album/${(a.ids ?? [a.id]).join(',')}`;
