// Favoris : ceux d'Emby (synchronisés avec les autres applis Emby).
// Les changements sont affichés immédiatement (« optimistes ») puis envoyés
// à Emby ; en cas d'échec on revient en arrière avec un message.
import { create } from 'zustand';
import { t } from '../i18n';
import { getClient } from './auth';
import { toast } from './toast';

interface FavoritesState {
  /** Changements faits pendant la session (prioritaires sur les données Emby). */
  overrides: Record<string, boolean>;
  /** Incrémenté à chaque changement : force le rechargement des listes « Favoris ». */
  version: number;
  set: (ids: string[], favorite: boolean) => Promise<void>;
}

export const useFavorites = create<FavoritesState>((set, get) => ({
  overrides: {},
  version: 0,
  set: async (ids, favorite) => {
    const client = getClient();
    if (!client || !ids.length) return;
    const previous = { ...get().overrides };
    const next = { ...previous };
    for (const id of ids) next[id] = favorite;
    set({ overrides: next, version: get().version + 1 });
    try {
      await Promise.all(ids.map((id) => client.setFavorite(id, favorite)));
      toast(favorite ? t('fav.added') : t('fav.removed'), 'success');
    } catch {
      set({ overrides: previous, version: get().version + 1 });
      toast(t('fav.error'), 'error');
    }
  },
}));

/** Le titre / l'album (un ou plusieurs identifiants Emby) est-il en favori ? */
export function useIsFavorite(item: { id: string; ids?: string[]; favorite?: boolean } | null | undefined) {
  return useFavorites((s) => {
    if (!item) return false;
    const ids = item.ids ?? [item.id];
    const o = ids.map((id) => s.overrides[id]).filter((v) => v !== undefined);
    return o.length ? o.some(Boolean) : !!item.favorite;
  });
}
