import { create } from 'zustand';
import { EmbyClient, Session } from '../api/emby';

const KEY = 'soundy.session';

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

interface AuthState {
  session: Session | null;
  client: EmbyClient | null;
  setSession: (s: Session) => void;
  logout: () => void;
}

const initial = load();

export const useAuth = create<AuthState>((set, get) => ({
  session: initial,
  client: initial ? new EmbyClient(initial) : null,
  setSession: (s) => {
    localStorage.setItem(KEY, JSON.stringify(s));
    set({ session: s, client: new EmbyClient(s) });
  },
  logout: () => {
    get().client?.logout();
    localStorage.removeItem(KEY);
    set({ session: null, client: null });
  },
}));

/** Accès direct (hors composants React). */
export const getClient = () => useAuth.getState().client;
