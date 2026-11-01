import { create } from 'zustand';

export type Theme = 'auto' | 'light' | 'dark';
export type DownloadQuality = 'original' | 'mp3';

interface Settings {
  theme: Theme;
  /** Débit maximum en streaming (bits/s). */
  streamBitrate: number;
  downloadQuality: DownloadQuality;
  /** URL du serveur de demandes Soundy (vide = même origine que l'app). */
  requestsUrl: string;
  /** Petites vibrations (défilement, boutons). */
  haptics: boolean;
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

const KEY = 'soundy.settings';

const defaults: Settings = {
  theme: 'auto',
  streamBitrate: 140_000_000,
  downloadQuality: 'original',
  requestsUrl: import.meta.env.VITE_REQUESTS_URL ?? '',
  haptics: true,
};

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    const { update: _u, ...rest } = { ...get() };
    localStorage.setItem(KEY, JSON.stringify(rest));
  },
}));

export const BITRATES = [
  { label: 'Originale (sans perte)', value: 140_000_000 },
  { label: 'Haute — 320 kb/s', value: 320_000 },
  { label: 'Normale — 192 kb/s', value: 192_000 },
  { label: 'Économie — 128 kb/s', value: 128_000 },
];
