// Vibrations légères (retour haptique) : natif sous Android, navigator.vibrate
// dans un navigateur mobile. Désactivables dans les Réglages.
import { useSettings } from '../store/settings';
import { isNative, nativeHaptic } from './native';

let last = 0;

function vibrate(type: 'tick' | 'click' | 'heavy', minGap: number) {
  if (!useSettings.getState().haptics) return;
  const now = performance.now();
  if (now - last < minGap) return; // évite un bourdonnement en défilement rapide
  last = now;
  if (isNative()) nativeHaptic(type);
  else navigator.vibrate?.(type === 'heavy' ? 25 : type === 'click' ? 10 : 5);
}

/** Très léger : passage d'un titre à l'autre dans la roue. */
export const hapticTick = () => vibrate('tick', 35);
/** Appui sur un bouton (lecture, suivant…). */
export const hapticClick = () => vibrate('click', 0);
/** Appui long (menu, sélection). */
export const hapticHeavy = () => vibrate('heavy', 0);
