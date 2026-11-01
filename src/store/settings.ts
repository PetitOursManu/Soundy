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
  /** Langue de l'interface (null = pas encore choisie : écran de choix au premier lancement). */
  language: 'fr' | 'en' | null;
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
  language: null,
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
  // Libellés : clés de traduction (voir src/i18n)
  { label: 'settings.bitrate.original', value: 140_000_000 },
  { label: 'settings.bitrate.high', value: 320_000 },
  { label: 'settings.bitrate.normal', value: 192_000 },
  { label: 'settings.bitrate.low', value: 128_000 },
];
