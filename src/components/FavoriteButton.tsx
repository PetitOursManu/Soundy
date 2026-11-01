import type { Album, Track } from '../api/emby';
import { useT } from '../i18n';
import { hapticClick } from '../lib/haptics';
import { useFavorites, useIsFavorite } from '../store/favorites';
import { IconHeart, IconHeartFilled } from './Icons';

/** Bouton ❤ : ajoute / retire un titre ou un album des favoris Emby. */
export function FavoriteButton({ item, className = 'icon-btn', size }: { item: Track | Album; className?: string; size?: number }) {
  const { t } = useT();
  const fav = useIsFavorite(item);
  const toggle = useFavorites((s) => s.set);
  return (
    <button
      className={`${className} fav-btn ${fav ? 'on' : ''}`}
      aria-pressed={fav}
      aria-label={fav ? t('fav.remove') : t('fav.add')}
      title={fav ? t('fav.remove') : t('fav.add')}
      onClick={(e) => {
        e.stopPropagation();
        hapticClick();
        void toggle((item as Album).ids ?? [item.id], !fav);
      }}
      style={size ? { width: size, height: size } : undefined}
    >
      {fav ? <IconHeartFilled /> : <IconHeart />}
    </button>
  );
}
