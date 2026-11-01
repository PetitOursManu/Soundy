// Synchronise le lecteur avec le service Android (notification, écran de
// verrouillage, boutons Bluetooth) quand l'application tourne sous Android.
import { audio, usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { isNative, onNativeMediaAction, updateNativePlayback } from './native';

export function initNativeBridge() {
  if (!isNative()) return;

  let lastKey = '';
  usePlayer.subscribe((s) => {
    const t = s.queue[s.index];
    if (!t) {
      if (lastKey) updateNativePlayback({ stop: true });
      lastKey = '';
      return;
    }
    // On ne notifie Android que lors d'un changement de titre / d'état / de durée
    const key = `${t.id}|${s.isPlaying}|${Math.round(s.duration)}`;
    if (key === lastKey) return;
    lastKey = key;
    updateNativePlayback({
      title: t.title,
      artist: t.artist,
      album: t.album,
      playing: s.isPlaying,
      position: audio.currentTime,
      duration: s.duration || t.duration,
    });
  });

  // Changement de langue : la notification Android est réécrite dans la nouvelle langue
  useSettings.subscribe((st, prev) => {
    if (st.language === prev.language) return;
    const s = usePlayer.getState();
    const t = s.queue[s.index];
    if (t) updateNativePlayback({ title: t.title, artist: t.artist, album: t.album, playing: s.isPlaying, position: audio.currentTime, duration: s.duration });
  });

  // Après un déplacement dans le titre, on recale la position affichée par Android
  audio.addEventListener('seeked', () => {
    const s = usePlayer.getState();
    const t = s.queue[s.index];
    if (t) updateNativePlayback({ title: t.title, artist: t.artist, album: t.album, playing: s.isPlaying, position: audio.currentTime, duration: s.duration });
  });

  onNativeMediaAction((action) => {
    const p = usePlayer.getState();
    switch (action) {
      case 'play':
        audio.play().catch(() => {});
        break;
      case 'pause':
        audio.pause();
        break;
      case 'nexttrack':
        p.next();
        break;
      case 'previoustrack':
        p.prev();
        break;
    }
  });
}
