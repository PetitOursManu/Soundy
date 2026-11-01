import { create } from 'zustand';
import type { Track } from '../api/emby';
import { getAudio, getCover } from '../lib/db';
import { shuffleArray } from '../lib/format';
import { getClient } from './auth';
import { useDownloads } from './downloads';
import { useNetwork } from './network';
import { useSettings } from './settings';
import { toast } from './toast';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Track[];
  index: number;
  original: Track[] | null; // ordre d'origine quand l'aléatoire est actif
  isPlaying: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  source: 'local' | 'stream' | null;
  sinkLabel: string | null;

  current: () => Track | undefined;
  playQueue: (tracks: Track[], startIndex?: number, opts?: { shuffle?: boolean }) => void;
  playAt: (index: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addNext: (tracks: Track[]) => void;
  addToQueue: (tracks: Track[]) => void;
  removeAt: (index: number) => void;
  setSink: (deviceId: string, label: string | null) => Promise<void>;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Élément audio unique pour toute l'application
// ---------------------------------------------------------------------------
export const audio = new Audio();
audio.preload = 'auto';

let objectUrl: string | null = null;
let artworkUrl: string | null = null;
let loadToken = 0;
let playSessionId = '';
let reportTimer: number | undefined;

const reportClient = () => (useNetwork.getState().online ? getClient() : null);

export const usePlayer = create<PlayerState>((set, get) => {
  /** Charge et (optionnellement) lance le titre courant. */
  async function load(autoplay: boolean) {
    const track = get().current();
    const token = ++loadToken;
    stopReport();
    if (!track) {
      audio.removeAttribute('src');
      audio.load();
      set({ isPlaying: false, source: null, currentTime: 0, duration: 0 });
      return;
    }

    set({ currentTime: 0, duration: track.duration, buffering: true });
    updateMediaSession(track);

    // 1) Lecture locale prioritaire si le titre est téléchargé
    let url: string | null = null;
    let source: 'local' | 'stream' = 'stream';
    if (useDownloads.getState().downloaded[track.id]) {
      const blob = await getAudio(track.id).catch(() => undefined);
      if (token !== loadToken) return;
      if (blob) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        url = objectUrl;
        source = 'local';
      }
    }

    // 2) Sinon streaming depuis Emby
    if (!url) {
      const client = getClient();
      if (!client || !useNetwork.getState().online) {
        toast(`« ${track.title} » n'est pas disponible hors ligne`, 'error');
        set({ buffering: false, isPlaying: false });
        skipToPlayable();
        return;
      }
      url = client.streamUrl(track.id, useSettings.getState().streamBitrate);
    }

    audio.src = url;
    set({ source });
    if (autoplay) {
      audio.play().catch((e) => {
        if (token !== loadToken) return;
        if ((e as DOMException).name !== 'AbortError') set({ isPlaying: false, buffering: false });
      });
    }
    startReport(track, source);
  }

  /** Hors ligne : saute au prochain titre téléchargé. */
  function skipToPlayable() {
    const { queue, index } = get();
    const dl = useDownloads.getState().downloaded;
    for (let i = index + 1; i < queue.length; i++) {
      if (dl[queue[i].id]) {
        set({ index: i });
        void load(true);
        return;
      }
    }
  }

  function startReport(track: Track, source: 'local' | 'stream') {
    playSessionId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    reportClient()?.reportStart(track.id, playSessionId, source === 'local' ? 'DirectPlay' : 'DirectStream');
    const id = track.id;
    const session = playSessionId;
    reportTimer = window.setInterval(() => {
      reportClient()?.reportProgress(id, session, audio.currentTime, audio.paused);
    }, 10_000);
  }

  function stopReport() {
    if (reportTimer) clearInterval(reportTimer);
    reportTimer = undefined;
    const prev = playSessionId && get().current();
    if (prev && playSessionId) reportClient()?.reportStopped(prev.id, playSessionId, audio.currentTime);
    playSessionId = '';
  }

  async function updateMediaSession(track: Track) {
    if (!('mediaSession' in navigator)) return;
    const artwork: MediaImage[] = [];
    const client = getClient();
    if (track.imageId) {
      const cover = useDownloads.getState().downloaded[track.id] ? await getCover(track.imageId).catch(() => undefined) : undefined;
      if (artworkUrl) URL.revokeObjectURL(artworkUrl);
      artworkUrl = null;
      if (cover) {
        artworkUrl = URL.createObjectURL(cover);
        artwork.push({ src: artworkUrl, sizes: '512x512', type: cover.type || 'image/jpeg' });
      } else if (client) {
        const src = client.imageUrl(track.imageId, track.imageTag, 512);
        if (src) artwork.push({ src, sizes: '512x512', type: 'image/jpeg' });
      }
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork,
    });
  }

  return {
    queue: [],
    index: 0,
    original: null,
    isPlaying: false,
    buffering: false,
    currentTime: 0,
    duration: 0,
    shuffle: false,
    repeat: 'off',
    source: null,
    sinkLabel: null,

    current: () => get().queue[get().index],

    playQueue: (tracks, startIndex = 0, opts = {}) => {
      if (!tracks.length) return;
      const shuffle = opts.shuffle ?? get().shuffle;
      if (shuffle) {
        const first = opts.shuffle ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[startIndex];
        const rest = shuffleArray(tracks.filter((t) => t !== first));
        set({ queue: [first, ...rest], index: 0, original: tracks, shuffle: true });
      } else {
        set({ queue: tracks, index: startIndex, original: null });
      }
      void load(true);
    },

    playAt: (index) => {
      if (index < 0 || index >= get().queue.length) return;
      set({ index });
      void load(true);
    },

    toggle: () => {
      if (!get().current()) return;
      if (!audio.src) {
        void load(true);
        return;
      }
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    },

    next: () => {
      const { queue, index, repeat } = get();
      if (!queue.length) return;
      if (index < queue.length - 1) set({ index: index + 1 });
      else if (repeat === 'all') set({ index: 0 });
      else {
        audio.pause();
        audio.currentTime = 0;
        return;
      }
      void load(true);
    },

    prev: () => {
      const { index } = get();
      if (audio.currentTime > 3 || index === 0) {
        audio.currentTime = 0;
        return;
      }
      set({ index: index - 1 });
      void load(true);
    },

    seek: (sec) => {
      if (!isFinite(sec)) return;
      audio.currentTime = Math.max(0, sec);
      set({ currentTime: audio.currentTime });
    },

    toggleShuffle: () => {
      const { shuffle, queue, index, original } = get();
      const current = queue[index];
      if (!shuffle) {
        const rest = shuffleArray(queue.filter((_, i) => i !== index));
        set({ shuffle: true, original: queue, queue: current ? [current, ...rest] : rest, index: 0 });
      } else {
        const base = original ?? queue;
        const newIndex = Math.max(0, base.findIndex((t) => t.id === current?.id));
        set({ shuffle: false, original: null, queue: base, index: newIndex });
      }
    },

    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
      audio.loop = repeat === 'one';
      set({ repeat });
    },

    addNext: (tracks) => {
      const { queue, index } = get();
      if (!queue.length) return get().playQueue(tracks);
      const q = queue.slice();
      q.splice(index + 1, 0, ...tracks);
      set({ queue: q });
      toast(tracks.length > 1 ? `${tracks.length} titres lus ensuite` : `« ${tracks[0].title} » sera lu ensuite`, 'success');
    },

    addToQueue: (tracks) => {
      const { queue } = get();
      if (!queue.length) return get().playQueue(tracks);
      set({ queue: [...queue, ...tracks] });
      toast(tracks.length > 1 ? `${tracks.length} titres ajoutés à la file` : `« ${tracks[0].title} » ajouté à la file`, 'success');
    },

    removeAt: (i) => {
      const { queue, index } = get();
      if (i === index) return;
      const q = queue.slice();
      q.splice(i, 1);
      set({ queue: q, index: i < index ? index - 1 : index });
    },

    setSink: async (deviceId, label) => {
      const el = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (!el.setSinkId) throw new Error('Non pris en charge');
      await el.setSinkId(deviceId);
      set({ sinkLabel: label });
    },

    stop: () => {
      stopReport();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      set({ queue: [], index: 0, original: null, isPlaying: false, source: null, currentTime: 0, duration: 0 });
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    },
  };
});

// ---------------------------------------------------------------------------
// Liaison des événements de l'élément audio avec le store
// ---------------------------------------------------------------------------
const st = () => usePlayer.getState();

audio.addEventListener('play', () => usePlayer.setState({ isPlaying: true }));
audio.addEventListener('pause', () => usePlayer.setState({ isPlaying: false }));
audio.addEventListener('playing', () => usePlayer.setState({ buffering: false }));
audio.addEventListener('waiting', () => usePlayer.setState({ buffering: true }));
audio.addEventListener('canplay', () => usePlayer.setState({ buffering: false }));
audio.addEventListener('timeupdate', () => {
  usePlayer.setState({ currentTime: audio.currentTime });
  if ('mediaSession' in navigator && isFinite(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        position: Math.min(audio.currentTime, audio.duration),
        playbackRate: audio.playbackRate,
      });
    } catch {
      /* ignoré */
    }
  }
});
audio.addEventListener('durationchange', () => {
  if (isFinite(audio.duration) && audio.duration > 0) usePlayer.setState({ duration: audio.duration });
});
audio.addEventListener('ended', () => {
  if (st().repeat !== 'one') st().next();
});
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  const t = st().current();
  usePlayer.setState({ buffering: false, isPlaying: false });
  toast(t ? `Lecture impossible : « ${t.title} »` : 'Lecture impossible', 'error');
});

// Contrôles système : écran de verrouillage, casque / enceinte Bluetooth, voiture…
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => audio.play().catch(() => {})],
    ['pause', () => audio.pause()],
    ['previoustrack', () => st().prev()],
    ['nexttrack', () => st().next()],
    ['seekto', (d) => d.seekTime !== undefined && st().seek(d.seekTime)],
    ['seekbackward', (d) => st().seek(audio.currentTime - (d.seekOffset ?? 10))],
    ['seekforward', (d) => st().seek(audio.currentTime + (d.seekOffset ?? 10))],
    ['stop', () => audio.pause()],
  ];
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action non supportée */
    }
  }
}

// Si l'appareil Bluetooth / la sortie audio est déconnecté(e), on met en pause
navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  const label = st().sinkLabel;
  if (!label) return;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const still = devices.some((d) => d.kind === 'audiooutput' && d.label === label);
  if (!still) {
    audio.pause();
    usePlayer.setState({ sinkLabel: null });
    toast(`${label} déconnecté — lecture en pause`);
  }
});
